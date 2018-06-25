'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);
const mkdirp = require('mkdirp-promise');
const gcs = require('@google-cloud/storage')();
gcs.interceptors.push({
  request: function(reqOpts) {
    reqOpts.forever = false
    return reqOpts
  }
})
const exec = require('child-process-promise').exec;

const LOCAL_TMP_FOLDER = '/tmp';
const BUCKETNAME = "hom2-40e87.appspot.com"

exports.onHeadCreate = functions.database.ref('/game/{gameId}/head')
    .onCreate((snap, context) => {
        var gameId = context.params.gameId
        return processPartAdded(snap, gameId)
    });
exports.onBodyCreate = functions.database.ref('/game/{gameId}/body')
    .onCreate((snap, context) => {
        var gameId = context.params.gameId
        return processPartAdded(snap, gameId)
    });
exports.onLegsCreate = functions.database.ref('/game/{gameId}/legs')
    .onCreate((snap, context) => {
        var gameId = context.params.gameId
        return processPartAdded(snap, gameId)
    });

function processPartAdded(snap, gameId) {
    console.log('onPartCreate called with key: ', snap.key)
    var all = new Set(["head", "body", "legs"]);
    all.delete(snap.key)
    var urls = []
    // check siblings to find out what parts are still needed
    // eg /game/1/head="head drawing"
    var query = snap.ref.parent.orderByKey(); // children of parent, ordered by key
    console.log('parent key: ' + snap.ref.parent.key)
    var result = query.once("value").then((snapshot) => {
        // eg /game/1
        console.log('numChildren: '+ snapshot.numChildren());
        snapshot.forEach((childSnapshot) => {
            // eg /game/1/body
            var key = childSnapshot.key; // eg "body"
            var childData = childSnapshot.val(); //eg "body drawing"
            if (childData.senderPhotoUrl) {
                urls.push(childData.senderPhotoUrl)
            }
            all.delete(key)
        });
        var command = Array.from(all)
        // write command for next player
        if (command.length === 0) {
            console.log("last part drawn")
            admin.database().ref('/inProgress/' + gameId).remove()
            admin.database().ref('/finished/' + gameId).set({'urls' : urls})
        } else {
            console.log("setting inProgress for " + gameId)
            admin.database().ref('/inProgress/' + gameId)
                .set({
                    'ref': gameId,
                    'urls': urls
                })
        }
        console.log("setting command:" + command)
        return Promise.all([
            admin.database().ref('game/' + gameId + '/command').set(command.toString()),
            saveHint(gameId, snap.key)
        ])
    });
    return result;
}


exports.joinImages = functions.database.ref('/finished/{gameId}')
    .onCreate(
        (snap, context) => {
            const gameId = context.params.gameId;

            // Download all files from the game and merge them together
            return downloadFiles(gameId)
                .then(
                    paths => {
                        return joinFrames(gameId)
                    }
                ).then(
                    () => {
                        console.log("joinFrames returned");
                        return uploadImage(gameId, 'out', 'merge') //copy from temp/gameId/out.jpg to  bucket/gameId/merge.jpg
                    }
                ).then(
                    () => {
                        console.log('The file has been uploaded');
                        return Promise.resolve("uploaded")
                    },
                    error => {
                        console.log("upload error", error);
                        return Promise.reject(new Error("upload error"))
                    }
                )
        },
        error => {
            console.log("convert error", error);
            return Promise.reject(new Error("convert error"))
        }
    );

function downloadFiles(gameId) {
    const path = LOCAL_TMP_FOLDER + '/' + gameId
    return mkdirp(path)
        .then(
            r => {
                console.log('Created temp dirs');
                const bucket = gcs.bucket(BUCKETNAME);
                return Promise.all(
                    [1,2,3].map((i) => bucket
                        .file(gameId + '-' + i + '.jpg')
                        .download({ destination: path + '/' + i + '.jpg' }))
                )
            },
            err => console.log("error making temp dir", err)
        ).then(
            r => {
                console.log("the files have been downloaded");
                // return array of local file paths
                return [1,2,3].map((i) => path + '/' + i + '.jpg')
            }, 
            err => console.log("error downloading files", err)
        )
}

function joinFrames(gameId) {
    var p1, p2, p3
    const path = LOCAL_TMP_FOLDER + '/' + gameId;
    [p1, p2, p3] = [1,2,3].map((i) => path + '/' + i + '.jpg')
    const cmd = 'convert ' + p1 + ' ' + p2 + ' ' +  p3 + ' -append ' + path + '/out.jpg'
    console.log("cmd:", cmd);
    return exec(cmd);
}

function uploadImage(gameId, src, dest) {
    const out = LOCAL_TMP_FOLDER + '/' + gameId + '/' + src + '.jpg'
    console.log('image created at', out);
    const bucket = gcs.bucket(BUCKETNAME);
    return bucket.upload(out, {
        destination: gameId + '/' + dest + '.jpg'
    });
}

function saveHint(gameId, part) {
    // Upload the hint
    return downloadFile(gameId, part)
        .then(
            path => {
                return createHint(gameId, part)
            },
            error => {
                console.log("saveHint error", error);
                return Promise.reject(new Error("saveHint error"))
            }
        ).then(
            () => {
                console.log("saveHint returned");
                return uploadHint(gameId, part)
            },
            error => {
                console.log("uploadHint error", error);
                return Promise.reject(new Error("uploadHint error"))
            }
        ).then(
            () => {
                console.log('The hint file has been uploaded');
                return Promise.resolve("uploaded")
            },
            error => {
                console.log("upload error", error);
                return Promise.reject(new Error("upload error"))
            }
        )
}

var mapper = {
    'head': {
        'key': 1,
        'hint': ['south'],
    },
    'body': {
        'key': 2,
        'hint': ['north', 'south'],
    },
    'legs': {
        'key': 3,
        'hint': ['north'],
    }
}

function downloadFile(gameId, part) {
    var partInt = mapper[part].key
    const path = LOCAL_TMP_FOLDER + '/' + gameId
    return mkdirp(path)
        .then(
            r => {
                console.log('Created temp dir');
                const bucket = gcs.bucket(BUCKETNAME);
                return bucket
                    .file(gameId + '-' + partInt + '.jpg')
                    .download({ destination: path + '/' + partInt + '.jpg' })
            },
            err => console.log("error making temp dir", err)
        ).then(
            r => {
                console.log("the file has been downloaded");
                // return array of local file paths
                return 
            }, 
            err => console.log("error downloading file", err)
        )
}

// output file like: gameId/1north.jpg
function createHint(gameId, part) {
    const path = LOCAL_TMP_FOLDER + '/' + gameId;
    var partInt = mapper[part].key
    var hintArray = mapper[part].hint
    var execArray = Array()
    hintArray.forEach((g) => {
        var cmd = 'convert ' + path + '/' + partInt +  '.jpg  -gravity ' + g + ' -crop 100x5% +repage ' + path + '/' + partInt + g + '.jpg' 
        console.log("cmd:", cmd);
        execArray.push(exec(cmd))
    })
    return Promise.all(execArray)
}


function uploadHint(gameId, part) {
    var partInt = mapper[part].key
    var hintArray = mapper[part].hint
    var execArray = Array()
    hintArray.forEach((g) => {
        var src = partInt + g
        var dest = src
        execArray.push(uploadImage(gameId, src, dest))
    })
    return Promise.all(execArray)
}
