// Meta app configuration used by the Facebook JS SDK in index.html.
//
// 1. Create/choose an app at https://developers.facebook.com/apps and copy its App ID.
// 2. Add this site's origin (e.g. http://localhost:3000 or https://yourdomain.com)
//    under App settings → Basic → App domains / Valid OAuth redirect URIs.
// 3. Request only scopes your app has been approved for. Unapproved permissions
//    show up in the login dialog as unavailable.
//
// Never put the App Secret in this file — it is public browser code.
window.META_CONFIG = {
  appId: 'YOUR_META_APP_ID',
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
