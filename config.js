// App and Database Configuration
// Edit this file to connect your shared Firebase database.
// The pre-shared password / subscription key can be set in the database under /rooms/our-secret-space/auth_pin
// or defaults to defaultPin if not yet in database.

window.APP_CONFIG = {
  // Shared Channel ID
  roomId: 'our-secret-space',

  // Fallback 4-digit key before it's fetched from the database
  defaultPin: '3A6B',

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
