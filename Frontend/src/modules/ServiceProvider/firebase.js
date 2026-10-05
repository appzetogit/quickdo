/**
 * Firebase Configuration
 * Initialize Firebase for push notifications
 */

import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { getDatabase } from 'firebase/database';

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL
};

// Initialize Firebase
let app;
let messaging;
let db;

try {
  if (firebaseConfig.projectId) {
    app = initializeApp(firebaseConfig);

    try {
      db = getDatabase(app);
    } catch (dbErr) {
      console.error('❌ Firebase DB initialization failed:', dbErr);
    }

    try {
      messaging = getMessaging(app);
      console.log('✅ Firebase Messaging initialized successfully');
    } catch (msgErr) {
      console.warn('⚠️ Firebase Messaging unsupported or blocked in this context:', msgErr?.message || msgErr);
    }

    console.log('✅ Firebase initialized successfully');
  } else {
    console.warn('⚠️ Firebase initialization skipped: Missing VITE_FIREBASE_PROJECT_ID in .env');
  }
} catch (error) {
  console.error('❌ Firebase initialization failed:', error);
}

export { app, messaging, db, getToken, onMessage };

