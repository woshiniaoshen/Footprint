# Firebase setup for Footprint

This migration uses Firebase Spark so you can keep working without a payment card.

## 1. Create Firebase project

1. Go to Firebase Console.
2. Create a project.
3. Add a Web app.
4. Copy the Firebase config values.

## 2. Enable services

Enable:

- Authentication > Sign-in method > Email/password
- Firestore Database
- Storage

## 3. Cloudflare Pages environment variables

In Cloudflare Pages > Settings > Environment variables, add:

```text
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Add the same values to `.env.local` for local testing.

## 4. Firestore collections

The app creates these automatically:

- `profiles`
- `locations`

## 5. Suggested Firebase rules for development

Use stricter rules before inviting real users. For development, this lets signed-in users use their own data and lets public uploads be visible in the heatmap:

```text
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /profiles/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }

    match /locations/{locationId} {
      allow create: if request.auth != null && request.resource.data.user_id == request.auth.uid;
      allow read: if request.auth != null && (resource.data.user_id == request.auth.uid || resource.data.is_public == true);
      allow update, delete: if request.auth != null && resource.data.user_id == request.auth.uid;
    }
  }
}
```

Storage rules:

```text
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{fileName} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Current limitations

- Admin changing another user's email/password is not available on Firebase Spark because it needs server admin functions.
- Existing Supabase data does not automatically migrate. New Firebase test users and uploads will start fresh.
