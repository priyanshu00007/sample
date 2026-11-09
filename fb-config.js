// Meta app configuration for Facebook Login.
//
// WHERE TO GET THE APP ID
// 1. Open https://developers.facebook.com/apps and sign in.
// 2. Create app → choose "Business" (or "Other" → Business) and name it Orbit.
// 3. App settings → Basic → copy "App ID" (a ~15–16 digit number).
//    The App Secret is on the same page — server-side only, never in this file.
// 4. On the same page, add App Domains: localhost
//    (add 127.0.0.1 too if you open the site that way).
// 5. Products → Facebook Login → Settings:
//    Client OAuth Login ON, Web OAuth Login ON,
//    Valid OAuth Redirect URIs: http://localhost:4173/
// 6. Add your Facebook account under App roles (Administrator or Tester).
//    While the app is in Development mode, only those accounts can log in.
// 7. Paste the App ID below, run `node server.js`, then open http://localhost:4173
//    (not a file:// URL — Facebook Login needs an http origin).
//
// The scopes below work for app admins/testers immediately, but need Advanced
// Access (App Review) before other people can grant them. Request the minimum
// your app actually uses.
//
// Never put the App Secret in this file: it is public browser code.
window.META_CONFIG = {
  appId: (typeof META_APP_ID !== 'undefined' ? META_APP_ID : 'ADD_YOUR_APP_ID'),
  apiVersion: 'v27.0',
  scopes: [
    'public_profile',
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'read_insights',
    'instagram_basic'
  ]
};
