"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = exports.firestore = void 0;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const firebaseServiceAccount_json_1 = __importDefault(require("./firebaseServiceAccount.json"));
if (!firebase_admin_1.default.apps.length) {
    firebase_admin_1.default.initializeApp({
        credential: firebase_admin_1.default.credential.cert(firebaseServiceAccount_json_1.default),
    });
}
exports.firestore = firebase_admin_1.default.firestore(); // 👈 THIS
exports.auth = firebase_admin_1.default.auth(); // optional but nice to have
