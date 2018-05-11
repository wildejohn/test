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
const BUCKETNAME = "fir-flutter-app-12964.appspot.com"

exports.onPartCreate = functions.database.ref('/game/{gameId}/{part}')
    .onCreate((snap, context) => {
        console.log('onPartCreate called with key: ', snap.key)
        var all = new Set(["head", "body", "legs"]);
        all.delete(snap.key)
        // check siblings to find out what parts are still needed
        // eg /game/1/head="head drawing"
        var query = snap.ref.parent.orderByKey(); // children of parent, ordered by key
        console.log('parent key: ' + snap.ref.parent.key)
        var result = query.once("value").then((snapshot) => {
                // eg /game/1
                console.log('numChildren: '+snapshot.numChildren());
                snapshot.forEach((childSnapshot) => {
                    // eg /game/1/body
                    var key = childSnapshot.key; // eg "body"
                    var childData = childSnapshot.val(); //eg "body drawing"
                    all.delete(key)
                });
                var command = Array.from(all)
                // write command for next player
                console.log("setting command:" + command)
                return snap.ref.parent.child('command').set(command.toString())
            });
        return result;
    });

// TODO: 
// client creates posts/:id object to store ref to bucket
// save :id in [head|body|legs] value
exports.joinImages = functions.database.ref('/game/{gameId}/command')
    .onCreate(
        (snap, context) => {
            const gameId = context.gameId;
            const uid = context.uid;
            // Set to true when game is complete
            if (event.data.val().length <= 1) 
                return Promise.reject(new Error("game not complete"))

            var gsPath1;
            // Download all files from the game and merge them together
            return downloadFiles(gameId)
                .then(
                    paths => {
                        gsPath1 = paths[0]
                        const gsPath2 = paths[1]
                        const gsPath3 = paths[2]
                        return joinFrames(gsPath1, gsPath2, gsPath3)
                    }
                ).then(
                    () => {
                        console.log("joinFrames returned");
                        return uploadImage(gsPath1)
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
    const gameRef = admin.database().ref(`games/${gameId}`);
    var gsPath1, gsPath2, gsPath3
    return gameRef.once('value')
        .then(
            snap => {
                const g10 = Object.keys(snap.child('head').val())[0]
                const g11 = Object.keys(snap.child('body').val())[0]
                const g12 = Object.keys(snap.child('legs').val())[0]

                // refs to posts
                var p1 = getPathPromise(g10)
                var p2 = getPathPromise(g11)
                var p3 = getPathPromise(g12)

                return Promise.all([p1, p2, p3])
            }
        ).then(
            results => {
                // refs to storage buckets
                console.log('Got image paths');
                gsPath1 = getPath(results[0])
                gsPath2 = getPath(results[1])
                gsPath3 = getPath(results[2])
                var f1 = makePathsPromise(gsPath1)
                var f2 = makePathsPromise(gsPath2)
                var f3 = makePathsPromise(gsPath3)

                // create temp dirs
                return Promise.all([f1, f2, f3])
            },
            err => console.log("error getting image paths" , err)
        ).then(
            results2 => {
                console.log('Created temp dirs');
                var f1 = getFilePromise(gsPath1)
                var f2 = getFilePromise(gsPath2)
                var f3 = getFilePromise(gsPath3)

                // download files
                return Promise.all([f1, f2, f3])
            }, 
            err => console.log("error making temp dirs" , err)
        ).then(
            results2 => {
                console.log("the files have been downloaded");
                // return array of local file paths
                return [gsPath1, gsPath2, gsPath3];
            }, 
            err => console.log("error downloading files", err)
        );
}

function getPathPromise(postId) {              
    return admin.database().ref(`posts/${postId}/full_storage_uri`).once('value')
}

function getPath(snap) {
    return snap.val().split('/').slice(3,7).join('/')
}

function stripFileName(gsPath) {
  const filePathSplit = gsPath.split('/');
  filePathSplit.pop(); // remove file name (eg. 0.jpg)
  return filePathSplit.join('/');
}

function getTempFilePath(gsPath) {
  return `${LOCAL_TMP_FOLDER}/${stripFileName(gsPath)}`;
}

function getTempFilePathAndName(gsPath) {
  return `${LOCAL_TMP_FOLDER}/${gsPath}`;
}

function makePathsPromise(filePath) {
    const tempPath = getTempFilePath(filePath);
    // Create the temp directory where the storage file will be downloaded.
    return mkdirp(tempPath);
}

function getFilePromise(filePath) {
    // Download file from bucket.
    const bucket = gcs.bucket(BUCKETNAME);
    return bucket.file(filePath).download({
        destination:  getTempFilePathAndName(filePath)
    })
}

function joinFrames(uri1, uri2, uri3) {
  const p1 = getTempFilePathAndName(uri1)
  const p2 = getTempFilePathAndName(uri2)
  const p3 = getTempFilePathAndName(uri3)
  const out = `${getTempFilePath(uri1)}/out.jpg`;
  const cmd = `convert ${p1} ${p2} ${p3} -append ${out}`;
  console.log("cmd:", cmd);
  return exec(cmd);
}

function uploadImage(uri1) {
  const out = `${getTempFilePath(uri1)}/out.jpg`;
  const uploadPath = `${stripFileName(uri1)}/merge.jpg`;
  console.log('image created at', out);
  const bucket = gcs.bucket(BUCKETNAME);
  return bucket.upload(out, {
        destination: uploadPath
  });
}
