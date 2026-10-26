// App and Database Configuration
// Edit this file to connect your shared Firebase database.
// The pre-shared password can be set in database /rooms/our-secret-space/auth_pin or uses pinHash.

window.APP_CONFIG = {
  // Shared Channel ID
  roomId: 'our-secret-space',

  // One-way cryptographic SHA-256 hash of the default PIN (Cannot be reversed)
  pinHash: '22cf79c3e77d6476dd6eb433b77e1d998023a55bf41fb480f7d79db0266ec8c7',

  // Firebase Realtime Database Configuration
  // Paste your Firebase project configuration here:
  firebase: {
    apiKey: "AIzaSyBCrfY_40V1aFGXeSlkDzsgSWmotc56uWs",
    authDomain: "quick-note-76c73.firebaseapp.com",
    databaseURL: "https://quick-note-76c73-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "quick-note-76c73",
    storageBucket: "quick-note-76c73.firebasestorage.app",
    messagingSenderId: "466787997120",
    appId: "1:466787997120:web:0f52413aae5db0f49c6425",
    measurementId: "G-9TPXR6RMV9"
  }
};
