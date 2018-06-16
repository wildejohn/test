const chai = require('chai');
const assert = chai.assert;
const sinon = require('sinon');
const admin = require('firebase-admin');
// Require and initialize firebase-functions-test in "online mode" with your project's
// credentials and service account key.
const projectConfig = {
    storageBucket: 'hom2-40e87.appspot.com',
    projectId: 'hom2-40e87',
    databaseURL: 'https://hom2-40e87.firebaseio.com/'
};

const test = require('firebase-functions-test')(projectConfig, './service-account-key.json');

describe('Cloud Functions', () => {
    var myFunctions;

    before(() => {
        // Require index.js and save the exports inside a namespace called myFunctions.
        // This includes our cloud functions, which can now be accessed at myFunctions.makeUppercase
        // and myFunctions.addMessage
        myFunctions = require('../index');
    });

    after(() => {
        // Do cleanup tasks.
        test.cleanup();
        // Reset the database.
        admin.database().ref('messages').remove();
        admin.database().ref('games/1').remove();
        admin.database().ref('games/2').remove();
    });

    describe('makeHead', () => {
        function getResult() {
            return admin.database().ref('games/1/command').once('value').then((createdSnap) => {
                console.log('created command:' + createdSnap.val());
                return assert.equal(createdSnap.val(), 'body,legs');
            });
        }
        it('should write command for next client in /command', () => {
            const snap = test.database.makeDataSnapshot('my drawing of a head', 'games/1/head');
            const wrapped = test.wrap(myFunctions.onPartCreate);
            return wrapped(snap).then(() => { return getResult() });
        });
    });

    describe('makeBody', () => {
        function setTestData() {
            return admin.database().ref('games/2/head').set('my drawing of a head')
        }
        function runTest() {
            const snap = test.database.makeDataSnapshot('my drawing of a body', 'games/2/body');
            const wrapped = test.wrap(myFunctions.onPartCreate);
            return wrapped(snap)
        }
        function assertSuccess() {
            return admin.database().ref('games/2/command').once('value').then((createdSnap) => {
                console.log('created command:' + createdSnap.val());
                return assert.equal(createdSnap.val(), 'legs');
            });
        }
        it('should write command for next client in /command', () => {
            return setTestData().then(() => {
                console.log('set test data');
                return runTest()
            }).then(() => { return assertSuccess() });
        });
    });
})
