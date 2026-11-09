// Meta Graph API sync: loads the signed-in user's profile, Pages, Page posts,
// Page insights and Instagram media, then fills the dashboard with live values.
//
// Everything here is client-side demo code. A production build should exchange
// the short-lived user token server-side and keep Page tokens out of the browser.

let metaSession = null;
let metaData = null;
let metaLoading = false;
let metaIsDemo = false;

function fbSdkReady() {
  return window.FB_SDK_READY === true && typeof FB !== 'undefined' &&
    typeof FB.api === 'function' && typeof FB.login === 'function';
}

function fbGet(path, params) {
  return new Promise(function (resolve, reject) {
    FB.api(path, params || {}, function (res) {
      if (res && !res.error) return resolve(res);
      const apiError = (res && res.error) || {};
      const err = new Error(apiError.message || 'Graph API request failed');
      err.code = apiError.code;
      err.type = apiError.type;
      reject(err);
    });
  });
}

function storeMetaSession(authResponse) {
  metaSession = {
    accessToken: authResponse.accessToken,
    userId: authResponse.userID,
    expiresIn: authResponse.expiresIn || null,
    obtainedAt: Date.now()
  };
}

function connectFacebook() {
  if (!fbSdkReady()) {
    openFbSetup();
    return;
  }

  metaIsDemo = false;

  FB.login(function (response) {
    if (!response.authResponse) {
      toast('Facebook login was cancelled or not authorized.');
      return;
    }

    // Kept in memory only. Swap this for a server-side token exchange in production.
    storeMetaSession(response.authResponse);
    loadMetaData();
  }, {
    scope: (window.META_CONFIG && META_CONFIG.scopes
      ? META_CONFIG.scopes
      : ['public_profile', 'pages_show_list']).join(',')
  });
}

function whenFbSdkReady(callback) {
  let attempts = 0;
  const timer = setInterval(function () {
    if (fbSdkReady()) {
      clearInterval(timer);
      callback();
      return;
    }
    attempts += 1;
    if (attempts > 300) clearInterval(timer);
  }, 100);
}

// On page load, ask Facebook whether this person is already connected to the app.
let metaStatusStarted = false;

function initMetaSession() {
  if (metaStatusStarted || !fbSdkReady() || typeof FB.getLoginStatus !== 'function') return;
  metaStatusStarted = true;
  renderFbLoginButton();
  FB.getLoginStatus(function (response) {
    statusChangeCallback(response);
  });
}

// Called from fbAsyncInit in index.html once FB.init has run.
window.initMetaSession = initMetaSession;

// Fallback for the case where fbAsyncInit fired before this file was parsed.
whenFbSdkReady(initMetaSession);

// Handles the three statuses FB.getLoginStatus can return.
function statusChangeCallback(response) {
  if (!response) return;

  if (response.status === 'connected' && response.authResponse) {
    storeMetaSession(response.authResponse);
    loadMetaData({ silent: true });
    return;
  }

  if (response.status === 'not_authorized') {
    // Logged into Facebook but this app has not been authorized yet: ask for it.
    renderLoggedOutState('not_authorized');
    toast('You are logged into Facebook but have not authorized Orbit yet. Use Connect account to continue.');
    return;
  }

  // 'unknown': not logged into Facebook (or FB.logout was called). Do not open a
  // login dialog automatically, browsers block popups without a user gesture.
  renderLoggedOutState('unknown');
}

// Called by the Facebook Login Button's onlogin attribute.
function checkLoginState() {
  if (!fbSdkReady() || typeof FB.getLoginStatus !== 'function') return;
  FB.getLoginStatus(function (response) {
    statusChangeCallback(response);
  });
}

// Renders the official Facebook Login Button with the scopes from fb-config.js.
function renderFbLoginButton() {
  const wrap = document.getElementById('fbLoginWrap');
  if (!wrap || wrap.dataset.rendered === '1' || !fbSdkReady() || !window.META_CONFIG) return;

  const scopes = (META_CONFIG.scopes && META_CONFIG.scopes.length
    ? META_CONFIG.scopes
    : ['public_profile']).join(',');

  wrap.innerHTML = '<fb:login-button scope="' + esc(scopes) + '" onlogin="checkLoginState();"></fb:login-button>';
  wrap.dataset.rendered = '1';
  wrap.style.display = 'flex';
  wrap.style.justifyContent = 'center';

  if (FB.XFBML && typeof FB.XFBML.parse === 'function') FB.XFBML.parse(wrap);
}

function renderLoggedOutState(status) {
  const plan = document.querySelector('.sidebar-bottom .plan');
  if (!plan) return;
  const title = plan.querySelector('strong');
  const text = plan.querySelector('p');
  const button = plan.querySelector('button');

  const dot = document.getElementById('connDot');
  if (dot) dot.classList.remove('show');

  if (status === 'not_authorized') {
    if (title) title.textContent = 'Facebook account found';
    if (text) text.textContent = 'Authorize Orbit to load your Pages and content.';
  } else {
    if (title) title.textContent = 'Connect your channels';
    if (text) text.textContent = 'Bring your Facebook Pages and Instagram accounts into one workspace.';
  }

  if (button) {
    button.textContent = '＋ Connect account';
    button.setAttribute('onclick', 'connectFacebook()');
  }
}

function loadMetaData(options) {
  const opts = options || {};
  if (metaIsDemo) {
    renderMetaData();
    toast('Demo data refreshed.');
    return;
  }
  if (!fbSdkReady()) {
    toast('Facebook SDK is not ready. Add your app ID in fb-config.js.');
    return;
  }
  if (metaLoading) return;

  metaLoading = true;
  if (!opts.silent) toast('Loading your Pages and latest content from Meta…');

  (async function () {
    try {
      const me = await fbGet('/me', { fields: 'id,name,picture.width(160).height(160)' });
      const accounts = await fbGet('/me/accounts', {
        fields: 'id,name,category,link,followers_count,fan_count,access_token,' +
          'instagram_business_account{id,name,username,followers_count,follows_count,media_count,profile_picture_url}',
        limit: 100
      });

      const pages = (accounts && accounts.data) || [];
      const bundles = await Promise.all(pages.map(function (page, index) {
        if (index >= 8) {
          return Promise.resolve({
            page: page,
            posts: [],
            insights: {},
            ig: page.instagram_business_account || null,
            igMedia: [],
            igReach: null
          });
        }
        return fetchPageBundle(page);
      }));

      metaData = { me: me, pages: bundles, fetchedAt: new Date() };
      renderMetaData();

      if (!pages.length) {
        toast('Signed in as ' + me.name + ', but no Pages were returned. Check pages_show_list and your Page permissions.');
      } else {
        toast('Live data loaded · ' + pages.length + ' Page' + (pages.length === 1 ? '' : 's') + ' from ' + me.name + '.');
      }
    } catch (err) {
      console.error('[Meta] sync failed', err);
      if (err && (err.code === 190 || err.type === 'OAuthException')) {
        metaSession = null;
        renderLoggedOutState('not_authorized');
        toast('Your Meta session expired. Connect Facebook again.');
      } else {
        toast('Could not load Meta data: ' + (err && err.message ? err.message : 'unknown error'));
      }
    } finally {
      metaLoading = false;
    }
  })();
}

function fetchPageBundle(page) {
  const token = page.access_token;
  const bundle = {
    page: page,
    posts: [],
    insights: {},
    ig: page.instagram_business_account || null,
    igMedia: [],
    igReach: null
  };
  const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

  const postsPromise = fbGet('/' + page.id + '/posts', {
    fields: 'id,message,created_time,permalink_url,attachments{media_type,title},shares,' +
      'reactions.summary(total_count),comments.summary(total_count)',
    limit: 25,
    since: since,
    access_token: token
  }).then(function (res) {
    bundle.posts = res.data || [];
  }).catch(function (err) {
    console.warn('[Meta] posts failed for ' + page.name + ': ' + err.message);
  });

  // Reach and impressions metrics changed in v26; ask for the current ones first,
  // then fall back to engagement alone so one invalid metric doesn't blank the card.
  const insightsPromise = fbGet('/' + page.id + '/insights', {
    metric: 'page_total_media_view_unique,page_media_view,page_post_engagements',
    period: 'days_28',
    access_token: token
  }).then(function (res) {
    storeInsights(bundle, res);
  }).catch(function (err) {
    console.warn('[Meta] insights failed for ' + page.name + ': ' + err.message);
    return fbGet('/' + page.id + '/insights', {
      metric: 'page_post_engagements',
      period: 'days_28',
      access_token: token
    }).then(function (res) {
      storeInsights(bundle, res);
    }).catch(function () {});
  });

  const igPromise = bundle.ig ? loadIgBundle(bundle, token) : Promise.resolve();

  return Promise.all([postsPromise, insightsPromise, igPromise]).then(function () {
    return bundle;
  });
}

function storeInsights(bundle, res) {
  ((res && res.data) || []).forEach(function (metric) {
    const values = metric.values || [];
    bundle.insights[metric.name] = values.length ? values[values.length - 1].value : null;
  });
}

function loadIgBundle(bundle, token) {
  const mediaPromise = fbGet('/' + bundle.ig.id + '/media', {
    fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
    limit: 12,
    access_token: token
  }).then(function (res) {
    bundle.igMedia = res.data || [];
  }).catch(function (err) {
    console.warn('[Meta] Instagram media failed: ' + err.message);
  });

  const reachPromise = fbGet('/' + bundle.ig.id + '/insights', {
    metric: 'reach',
    period: 'day',
    limit: 30,
    access_token: token
  }).then(function (res) {
    const values = (res.data && res.data[0] && res.data[0].values) || [];
    bundle.igReach = values.reduce(function (sum, value) {
      return sum + (Number(value.value) || 0);
    }, 0);
  }).catch(function () {
    bundle.igReach = null;
  });

  return Promise.all([mediaPromise, reachPromise]);
}

/* ---------------------------------------------------------------- rendering */

function renderMetaData() {
  if (!metaData) return;
  renderOverview(metaData);
  renderChannels(metaData);
  renderRecentContent(metaData);
  renderPages(metaData);
  renderPageContent(metaData);
  renderInstagram(metaData);
  renderInsights(metaData);
  renderConnectionState(metaData);

  const profileModal = document.getElementById('profileModal');
  if (profileModal && profileModal.classList.contains('show')) renderProfileModal();
}

function renderOverview(data) {
  const totals = metaTotals(data);
  const cards = document.querySelectorAll('#overview .stats > .card');
  const channelLabel = totals.pageCount + ' Page' + (totals.pageCount === 1 ? '' : 's') +
    ' · ' + totals.igCount + ' Instagram';

  setStatCard(cards[0], fmtNum(totals.followers), channelLabel);
  setStatCard(cards[1], compact(totals.reach),
    totals.reach == null ? 'Not available for this account' : 'Page + Instagram reach · 28 days');
  const rate = engagementRate(totals.interactions, totals.reach, totals.followers);
  setStatCard(cards[2], rate == null ? '—' : rate.toFixed(2) + '%',
    totals.interactions ? compact(totals.interactions) + ' interactions vs reach · 28 days' : 'No engagement data');
  setStatCard(cards[3], fmtNum(totals.recentPosts), 'From recent posts · last 30 days');

  const notice = document.querySelector('#overview .notice');
  if (notice) {
    notice.innerHTML = metaIsDemo
      ? '<b>ⓘ Demo account</b> Sample profile, Pages and posts for exploring the dashboard. Add your Meta app ID in fb-config.js to load real data.'
      : '<b>ⓘ Live Meta data</b> Loaded from the Graph API for ' + esc(data.me.name) +
        ' at ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) +
        '. Values depend on the permissions granted to your app.';
  }

  const chart = document.querySelector('#overview .chart');
  const chartCard = chart && chart.closest('.card');
  const chartSubtitle = chartCard && chartCard.querySelector('.card-head p');
  if (chartSubtitle) chartSubtitle.textContent = 'Illustrative trend · live totals are in the cards above';
}

function renderChannels(data) {
  const list = document.querySelector('#overview .platform-list');
  if (!list) return;
  const rows = [platformRow('fb', 'f', data.me.name, 'Facebook profile · Connected', 'Connected')];
  data.pages.forEach(function (bundle) {
    rows.push(platformRow('fb', 'f', bundle.page.name,
      'Facebook Page · ' + compact(pageFollowers(bundle.page)) + ' followers', 'Active'));
  });
  data.pages.forEach(function (bundle) {
    if (!bundle.ig) return;
    rows.push(platformRow('ig', '◎', '@' + (bundle.ig.username || 'instagram'),
      'Instagram · ' + compact(bundle.ig.followers_count) + ' followers', 'Active'));
  });
  list.innerHTML = rows.join('');
}

function renderRecentContent(data) {
  const tbody = document.querySelector('#overview table.table tbody');
  if (!tbody) return;
  const items = collectContent(data).slice(0, 5);
  if (!items.length) {
    tbody.innerHTML = emptyRow(6, 'No posts were returned by the Graph API yet.');
    return;
  }
  tbody.innerHTML = items.map(function (item) {
    return '<tr><td><div class="post-title"><div class="post-thumb">' + thumbFor(item.type) +
      '</div><div><strong>' + esc(clip(item.title || 'Untitled post', 60)) + '</strong><small>' +
      esc(item.type) + '</small></div></div></td><td>' +
      esc(item.platform + ' · ' + item.channel) + '</td><td>' + fmtDate(item.date) +
      '</td><td>' + fmtNum(item.reactions) + '</td><td>' + fmtNum(item.comments) +
      '</td><td><span class="status">Published</span></td></tr>';
  }).join('');
}

function renderPages(data) {
  const grid = document.querySelector('#pages .page-grid');
  if (!grid) return;
  const cards = data.pages.map(function (bundle) {
    const followers = pageFollowers(bundle.page);
    const engagements = Number(bundle.insights.page_post_engagements) || 0;
    const rate = engagementRate(engagements, bundle.insights.page_total_media_view_unique, followers);
    return '<div class="account-card">' +
      '<div class="account-card-top"><div class="account-name"><div class="platform-logo fb">f</div>' +
      '<div><strong>' + esc(bundle.page.name) + '</strong><small>' + esc(bundle.page.category || 'Facebook Page') +
      '</small></div></div><span class="pill">Connected</span></div>' +
      '<div class="account-stats">' +
      '<div><b>' + fmtNum(followers) + '</b><small>Followers</small></div>' +
      '<div><b>' + compact(bundle.insights.page_total_media_view_unique) + '</b><small>Reach · 28 days</small></div>' +
      '<div><b>' + fmtNum((bundle.posts || []).length) + '</b><small>Recent posts</small></div>' +
      '<div><b>' + (rate == null ? '—' : rate.toFixed(2) + '%') + '</b><small>Engagement</small></div>' +
      '</div>' +
      '<div class="account-actions">' +
      '<button class="btn" data-href="' + esc(bundle.page.link || ('https://www.facebook.com/' + bundle.page.id)) + '">View on Facebook</button>' +
      '<button class="btn" data-section-target="insights">Insights</button>' +
      '</div></div>';
  }).join('');

  grid.innerHTML = cards + connectPageCard();

  grid.querySelectorAll('[data-href]').forEach(function (button) {
    button.addEventListener('click', function () {
      window.open(button.getAttribute('data-href'), '_blank', 'noopener');
    });
  });
  grid.querySelectorAll('[data-section-target]').forEach(function (button) {
    button.addEventListener('click', function () {
      showSection(button.getAttribute('data-section-target'));
    });
  });
}

function connectPageCard() {
  return '<div class="account-card" style="border-style:dashed;display:grid;place-items:center;' +
    'text-align:center;min-height:190px"><div><div style="font-size:25px;color:var(--purple)">＋</div>' +
    '<b style="display:block;margin:8px">Connect another Page</b>' +
    '<small style="color:var(--muted)">Discover Pages you manage</small>' +
    '<button class="btn" style="margin-top:13px" onclick="connectFacebook()">Connect Facebook</button>' +
    '</div></div>';
}

function renderPageContent(data) {
  const tbody = document.querySelector('#pages table.table tbody');
  if (!tbody) return;
  const items = collectPagePosts(data).slice(0, 12);
  if (!items.length) {
    tbody.innerHTML = emptyRow(6, 'No Page posts were returned for the last 30 days.');
    return;
  }
  tbody.innerHTML = items.map(function (item) {
    return '<tr><td><div class="post-title"><div class="post-thumb">' + thumbFor(item.type) +
      '</div><div><strong>' + esc(clip(item.title || 'Untitled post', 70)) + '</strong><small>' +
      esc(item.channel) + '</small></div></div></td><td>' + esc(item.type) + '</td><td>' +
      fmtDate(item.date) + '</td><td>' + fmtNum(item.reactions) + '</td><td>' +
      fmtNum(item.comments) + '</td><td><span class="status">Published</span></td></tr>';
  }).join('');
}

function renderInstagram(data) {
  const profile = document.querySelector('#instagram .profile');
  if (!profile) return;
  const bundle = data.pages.filter(function (page) { return page.ig; })[0];
  const heading = profile.querySelector('h3');
  const subline = profile.querySelector('p');
  const picture = profile.querySelector('.profile-pic');
  const numbers = document.querySelectorAll('#instagram .profile-numbers b');

  if (!bundle) {
    if (heading) heading.textContent = 'No Instagram account';
    if (subline) subline.textContent = 'Link an Instagram professional account to a Page';
    numbers.forEach(function (node) { node.textContent = '—'; });
    const notice = document.querySelector('#instagram .notice');
    if (notice) {
      notice.innerHTML = '<b>Instagram API requirement</b> No Instagram Business or Creator account was ' +
        'returned for your Pages. Link one to a Page and approve instagram_basic.';
    }
    return;
  }

  const ig = bundle.ig;
  if (heading) heading.textContent = ig.name || ig.username || 'Instagram account';
  if (subline) subline.textContent = '@' + (ig.username || 'instagram') + ' · Professional account';
  if (picture) {
    if (ig.profile_picture_url) {
      picture.textContent = '';
      picture.style.backgroundImage = 'url("' + ig.profile_picture_url + '")';
      picture.style.backgroundSize = 'cover';
      picture.style.backgroundPosition = 'center';
    } else {
      picture.textContent = (ig.name || ig.username || 'I').charAt(0).toUpperCase();
    }
  }
  if (numbers.length) {
    numbers[0].textContent = fmtNum(ig.followers_count);
    numbers[1].textContent = fmtNum(ig.follows_count);
    numbers[2].textContent = fmtNum(ig.media_count);
  }

  const interactions = igInteractions(bundle);
  const rate = engagementRate(interactions, bundle.igReach, Number(ig.followers_count));
  const performanceSubtitle = document.querySelector('#instagram .card-head p');
  if (performanceSubtitle) performanceSubtitle.textContent = 'From your most recent media';

  const performance = document.querySelectorAll('#instagram .account-stats b');
  if (performance.length) {
    performance[0].textContent = compact(bundle.igReach);
    performance[1].textContent = fmtNum(interactions);
    performance[2].textContent = '—';
    performance[3].textContent = rate == null ? '—' : rate.toFixed(2) + '%';
  }

  const feed = document.querySelector('#instagram .feed-grid');
  if (feed) {
    feed.innerHTML = '';
    (bundle.igMedia || []).forEach(function (media) {
      const tile = document.createElement('a');
      tile.className = 'feed-tile';
      tile.href = media.permalink || '#';
      tile.target = '_blank';
      tile.rel = 'noopener';
      tile.title = clip(media.caption || 'Instagram media', 90);
      const source = media.media_type === 'VIDEO'
        ? (media.thumbnail_url || media.media_url)
        : (media.media_url || media.thumbnail_url);
      if (source) {
        tile.style.backgroundImage = 'url("' + source + '")';
        tile.style.backgroundSize = 'cover';
        tile.style.backgroundPosition = 'center';
      } else {
        tile.textContent = '◎';
      }
      feed.appendChild(tile);
    });
    if (!feed.children.length) feed.innerHTML = '<div class="feed-tile">◎</div>';
  }

  const note = feed && feed.parentElement && feed.parentElement.querySelector('.empty');
  if (note) {
    note.textContent = 'Live Instagram media · ' + (bundle.igMedia || []).length + ' recent item' +
      ((bundle.igMedia || []).length === 1 ? '' : 's');
  }
}

function renderInsights(data) {
  const totals = metaTotals(data);
  const cards = document.querySelectorAll('#insights .stats > .card');
  setStatCard(cards[0], compact(totals.reach),
    totals.reach == null ? 'Not available for this account' : 'Page + Instagram reach · 28 days');
  setStatCard(cards[1], compact(totals.mediaViews),
    totals.mediaViews == null ? 'Not available for this account' : 'Page media views · 28 days');
  setStatCard(cards[2], fmtNum(totals.interactions), 'Page post engagements · 28 days');
  setStatCard(cards[3], '—', 'Follower growth is not exposed by the API');

  const labels = document.querySelectorAll('#insights .stat-top');
  if (labels[1]) labels[1].textContent = 'Media views';

  const tbody = document.querySelector('#insights table.table tbody');
  if (tbody) {
    const rows = [];
    data.pages.forEach(function (bundle) {
      const followers = pageFollowers(bundle.page);
      const engagements = Number(bundle.insights.page_post_engagements) || 0;
      const rate = engagementRate(engagements, bundle.insights.page_total_media_view_unique, followers);
      rows.push('<tr><td>f Facebook · ' + esc(bundle.page.name) + '</td><td>' + fmtNum(followers) +
        '</td><td>' + compact(bundle.insights.page_total_media_view_unique) + '</td><td>' +
        (rate == null ? '—' : rate.toFixed(2) + '%') + '</td><td>' + fmtNum((bundle.posts || []).length) +
        '</td></tr>');
    });
    data.pages.forEach(function (bundle) {
      if (!bundle.ig) return;
      const interactions = igInteractions(bundle);
      const rate = engagementRate(interactions, bundle.igReach, Number(bundle.ig.followers_count));
      rows.push('<tr><td>◎ Instagram · @' + esc(bundle.ig.username || 'instagram') + '</td><td>' +
        fmtNum(bundle.ig.followers_count) + '</td><td>' + compact(bundle.igReach) + '</td><td>' +
        (rate == null ? '—' : rate.toFixed(2) + '%') + '</td><td>' + fmtNum(bundle.ig.media_count) +
        '</td></tr>');
    });
    tbody.innerHTML = rows.length ? rows.join('') : emptyRow(5, 'No channels were returned by the API.');
  }

  const comparisonSubtitle = document.querySelector('#insights .card-head p');
  if (comparisonSubtitle) comparisonSubtitle.textContent = 'Performance summary · Live values';
}

function renderConnectionState(data) {
  const plan = document.querySelector('.sidebar-bottom .plan');
  if (!plan) return;
  const title = plan.querySelector('strong');
  const text = plan.querySelector('p');
  const button = plan.querySelector('button');
  if (title) title.textContent = metaIsDemo ? 'Demo account active' : 'Facebook connected';
  if (text) {
    text.textContent = metaIsDemo
      ? 'Sample profile and Pages · connect Meta for live data'
      : 'Signed in as ' + data.me.name + ' · ' + data.pages.length +
        ' Page' + (data.pages.length === 1 ? '' : 's');
  }
  if (button) {
    button.textContent = metaIsDemo ? 'Exit demo mode' : '↻ Refresh Meta data';
    button.setAttribute('onclick', metaIsDemo ? 'exitDemo()' : 'loadMetaData()');
  }

  const navCount = document.querySelector('#mainNav [data-section="pages"] .count');
  if (navCount) navCount.textContent = data.pages.length;

  const letters = initials(data.me.name);
  const topAvatar = document.getElementById('topAvatar');
  if (topAvatar) topAvatar.textContent = letters;
  const sideAvatar = document.getElementById('sideAvatar');
  if (sideAvatar) sideAvatar.textContent = letters;
  const sidebarName = document.getElementById('sidebarUserName');
  if (sidebarName) sidebarName.textContent = data.me.name;
  const dot = document.getElementById('connDot');
  if (dot) {
    dot.classList.add('show');
    dot.classList.toggle('demo', metaIsDemo);
  }
}

/* ----------------------------------------------------------------- helpers */

function metaTotals(data) {
  const totals = {
    followers: 0,
    reach: null,
    mediaViews: null,
    interactions: 0,
    pageCount: data.pages.length,
    igCount: 0,
    recentPosts: 0
  };
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  data.pages.forEach(function (bundle) {
    totals.followers += pageFollowers(bundle.page);

    if (bundle.insights.page_total_media_view_unique != null) {
      totals.reach = (totals.reach || 0) + Number(bundle.insights.page_total_media_view_unique);
    }
    if (bundle.insights.page_media_view != null) {
      totals.mediaViews = (totals.mediaViews || 0) + Number(bundle.insights.page_media_view);
    }
    totals.interactions += Number(bundle.insights.page_post_engagements) || 0;

    if (bundle.ig) {
      totals.igCount += 1;
      totals.followers += Number(bundle.ig.followers_count) || 0;
      if (bundle.igReach != null) totals.reach = (totals.reach || 0) + bundle.igReach;
    }

    (bundle.posts || []).forEach(function (post) {
      if (new Date(post.created_time).getTime() >= cutoff) totals.recentPosts += 1;
    });
    (bundle.igMedia || []).forEach(function (media) {
      if (new Date(media.timestamp).getTime() >= cutoff) totals.recentPosts += 1;
    });
  });

  return totals;
}

function collectContent(data) {
  const items = collectPagePosts(data);
  data.pages.forEach(function (bundle) {
    (bundle.igMedia || []).forEach(function (media) {
      items.push({
        platform: '◎ Instagram',
        channel: '@' + (bundle.ig.username || 'instagram'),
        title: media.caption,
        type: igMediaType(media.media_type),
        date: new Date(media.timestamp),
        reactions: Number(media.like_count) || 0,
        comments: Number(media.comments_count) || 0
      });
    });
  });
  return items.sort(function (a, b) { return b.date - a.date; });
}

function collectPagePosts(data) {
  const items = [];
  data.pages.forEach(function (bundle) {
    (bundle.posts || []).forEach(function (post) {
      items.push({
        platform: 'f Facebook',
        channel: bundle.page.name,
        title: post.message,
        type: fbPostType(post),
        date: new Date(post.created_time),
        reactions: Number(post.reactions && post.reactions.summary && post.reactions.summary.total_count) || 0,
        comments: Number(post.comments && post.comments.summary && post.comments.summary.total_count) || 0
      });
    });
  });
  return items.sort(function (a, b) { return b.date - a.date; });
}

function engagementRate(interactions, reach, followers) {
  const denominator = Number(reach) || Number(followers) || 0;
  if (!denominator) return null;
  return (Number(interactions) || 0) / denominator * 100;
}

function igInteractions(bundle) {
  return (bundle.igMedia || []).reduce(function (sum, media) {
    return sum + (Number(media.like_count) || 0) + (Number(media.comments_count) || 0);
  }, 0);
}

function pageFollowers(page) {
  const value = page.followers_count != null ? page.followers_count : page.fan_count;
  return Number(value) || 0;
}

function fbPostType(post) {
  const attachment = post && post.attachments && post.attachments.data && post.attachments.data[0];
  const type = attachment && attachment.media_type;
  if (!type) return 'Post';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function igMediaType(type) {
  const labels = { IMAGE: 'Image', VIDEO: 'Video', CAROUSEL_ALBUM: 'Carousel', REELS: 'Reel' };
  return labels[type] || 'Post';
}

function thumbFor(type) {
  const value = String(type || '').toLowerCase();
  if (value.indexOf('video') >= 0 || value.indexOf('reel') >= 0) return '▶';
  if (value.indexOf('album') >= 0 || value.indexOf('carousel') >= 0) return '▤';
  if (value.indexOf('photo') >= 0 || value.indexOf('image') >= 0) return '▣';
  return '✎';
}

function platformRow(platformClass, glyph, name, description, status) {
  return '<div class="platform"><div class="platform-logo ' + platformClass + '">' + glyph +
    '</div><div class="platform-info"><strong>' + esc(name) + '</strong><small>' + esc(description) +
    '</small></div><span class="pill">' + esc(status) + '</span></div>';
}

function setStatCard(card, value, note) {
  if (!card) return;
  const valueNode = card.querySelector('.stat-value');
  const noteNode = card.querySelector('.change');
  if (valueNode) valueNode.textContent = value;
  if (noteNode) {
    noteNode.textContent = note;
    noteNode.style.color = 'var(--muted)';
  }
}

function emptyRow(columns, message) {
  return '<tr><td colspan="' + columns +
    '" style="text-align:center;color:var(--muted);padding:26px 10px">' + esc(message) + '</td></tr>';
}

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
  });
}

function clip(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function fmtNum(value) {
  const number = Number(value);
  return value == null || isNaN(number) ? '—' : number.toLocaleString('en-US');
}

function compact(value) {
  if (value == null) return '—';
  const number = Number(value);
  if (isNaN(number)) return '—';
  if (Math.abs(number) >= 1e6) return (number / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(number) >= 1e3) return (number / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(number);
}

function fmtDate(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

/* -------------------------------------------------------------- profile UI */

const profileModalEl = document.getElementById('profileModal');
if (profileModalEl) {
  profileModalEl.addEventListener('click', function (event) {
    if (event.target === profileModalEl) closeProfile();
  });
}

function openProfile() {
  const modal = document.getElementById('profileModal');
  if (!modal) return;
  if (typeof closeNav === 'function') closeNav();
  renderProfileModal();
  modal.classList.add('show');
  document.body.classList.add('modal-open');
}

function closeProfile() {
  const modal = document.getElementById('profileModal');
  if (!modal) return;
  modal.classList.remove('show');
  document.body.classList.remove('modal-open');
}

function renderProfileModal() {
  const body = document.getElementById('profileBody');
  if (!body) return;

  if (!metaSession || !metaData) {
    body.innerHTML = '<div class="profile-hero"><div class="profile-avatar">?</div>' +
      '<div><strong>Not signed in</strong><span>Connect Facebook to see your profile and Pages</span></div></div>' +
      '<p class="profile-note">Facebook Login needs a Meta app ID in <b>fb-config.js</b>. ' +
      'Click below for the exact setup steps, or explore the dashboard with sample account data first.</p>' +
      '<div class="profile-actions"><button class="btn primary" onclick="closeProfile();connectFacebook()">Continue with Facebook</button>' +
      '<button class="btn" onclick="enterDemoAccount()">View demo account</button></div>';
    return;
  }

  const me = metaData.me;
  const pages = metaData.pages;
  const igCount = pages.filter(function (bundle) { return bundle.ig; }).length;

  const pageRows = pages.map(function (bundle) {
    const followers = pageFollowers(bundle.page);
    const ig = bundle.ig && bundle.ig.username ? ' · @' + bundle.ig.username : '';
    return '<div class="profile-channel"><div class="platform-logo fb">f</div>' +
      '<div class="platform-info"><strong>' + esc(bundle.page.name) + '</strong>' +
      '<small>Facebook Page · ' + compact(followers) + ' followers' + esc(ig) + '</small></div>' +
      '<span class="pill">Active</span></div>';
  }).join('');

  body.innerHTML = '<div class="profile-hero"><div class="profile-avatar">' + esc(initials(me.name)) +
    '</div><div><strong>' + esc(me.name) + '</strong><span>' +
    (metaIsDemo ? 'Demo account · sample data' : 'Facebook profile · Connected') + '</span></div>' +
    '<span class="pill' + (metaIsDemo ? ' demo' : '') + '">' + (metaIsDemo ? 'Demo' : 'Live') + '</span></div>' +
    '<div class="detail-grid">' +
    '<div class="detail-item"><small>Facebook user ID</small><b>' + esc(me.id) + '</b></div>' +
    '<div class="detail-item"><small>Pages</small><b>' + pages.length + '</b></div>' +
    '<div class="detail-item"><small>Instagram accounts</small><b>' + igCount + '</b></div>' +
    '<div class="detail-item"><small>Session</small><b>' + esc(sessionExpiryLabel()) + '</b></div>' +
    '</div>' +
    '<div class="profile-section"><h4>Pages you manage</h4>' +
    (pageRows || '<div class="empty" style="padding:14px">No Pages were returned.</div>') + '</div>' +
    '<p class="profile-note">' + (metaIsDemo
      ? 'This is sample data. Add a Meta app ID in fb-config.js to sign in with your real account.'
      : 'Details come from the Meta Graph API and refresh when the dashboard reloads.') + '</p>' +
    '<div class="profile-actions">' + (metaIsDemo
      ? '<button class="btn" onclick="enterDemoAccount()">↻ Refresh demo</button>' +
        '<button class="btn" onclick="exitDemo()">Exit demo</button>'
      : '<button class="btn" onclick="loadMetaData()">↻ Refresh details</button>' +
        '<button class="btn" onclick="disconnectFacebook()">Log out</button>') + '</div>';
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
}

function sessionExpiryLabel() {
  if (metaIsDemo) return 'Demo session';
  if (!metaSession || !metaSession.expiresIn || !metaSession.obtainedAt) return 'Active';
  const left = metaSession.obtainedAt + Number(metaSession.expiresIn) * 1000 - Date.now();
  if (left <= 0) return 'Expired';
  const minutes = Math.round(left / 60000);
  if (minutes >= 2880) return Math.round(minutes / 1440) + 'd remaining';
  if (minutes >= 120) return Math.round(minutes / 60) + 'h remaining';
  return Math.max(1, minutes) + 'm remaining';
}

function disconnectFacebook() {
  if (!fbSdkReady() || typeof FB.logout !== 'function') {
    closeProfile();
    return;
  }
  FB.logout(function () {
    metaSession = null;
    metaData = null;
    metaIsDemo = false;
    metaStatusStarted = false;
    closeProfile();
    toast('Logged out of Facebook. Reloading demo data…');
    setTimeout(function () { window.location.reload(); }, 700);
  });
}

/* ---------------------------------------------------------- setup + demo */

const fbSetupModalEl = document.getElementById('fbSetupModal');
if (fbSetupModalEl) {
  fbSetupModalEl.addEventListener('click', function (event) {
    if (event.target === fbSetupModalEl) closeFbSetup();
  });
}

function openFbSetup() {
  const modal = document.getElementById('fbSetupModal');
  if (!modal) {
    toast('Add your Meta app ID in fb-config.js to enable Facebook Login.');
    return;
  }
  if (typeof closeNav === 'function') closeNav();
  if (typeof closeProfile === 'function') closeProfile();
  modal.classList.add('show');
  document.body.classList.add('modal-open');
}

function closeFbSetup() {
  const modal = document.getElementById('fbSetupModal');
  if (!modal) return;
  modal.classList.remove('show');
  document.body.classList.remove('modal-open');
}

function enterDemoAccount() {
  metaIsDemo = true;
  metaSession = { demo: true, userId: 'demo_account', obtainedAt: Date.now() };
  metaData = demoAccountData();
  closeFbSetup();
  renderMetaData();
  toast('Demo account loaded — sample profile, Pages and posts.');
}

function exitDemo() {
  metaIsDemo = false;
  metaSession = null;
  metaData = null;
  closeFbSetup();
  closeProfile();
  window.location.reload();
}

function demoAccountData() {
  const day = 864e5;
  const iso = function (offset) { return new Date(Date.now() - offset * day).toISOString(); };
  return {
    me: { id: 'demo_1000042', name: 'Priyanshu Rathod' },
    fetchedAt: new Date(),
    pages: [
      {
        page: {
          id: 'demo_page_1', name: 'PriyanshLabs', category: 'Software Company',
          link: 'https://www.facebook.com/', followers_count: 8420, fan_count: 8100, access_token: 'demo'
        },
        posts: [
          {
            message: 'How API rate limiting works in production', created_time: iso(1),
            reactions: { summary: { total_count: 342 } }, comments: { summary: { total_count: 28 } },
            attachments: { data: [{ media_type: 'photo' }] }
          },
          {
            message: 'Shipping the new social control center', created_time: iso(6),
            reactions: { summary: { total_count: 120 } }, comments: { summary: { total_count: 9 } },
            attachments: { data: [{ media_type: 'video' }] }
          }
        ],
        insights: {
          page_total_media_view_unique: 64200, page_media_view: 128400, page_post_engagements: 9420
        },
        ig: {
          id: 'demo_ig_1', name: 'Priyansh Labs', username: 'priyanshlabs',
          followers_count: 16472, follows_count: 284, media_count: 126
        },
        igMedia: [
          {
            caption: '5 backend concepts every developer should know', media_type: 'VIDEO',
            permalink: 'https://www.instagram.com/', timestamp: iso(1), like_count: 840, comments_count: 33
          },
          {
            caption: 'Build projects that prove your skills', media_type: 'CAROUSEL_ALBUM',
            permalink: 'https://www.instagram.com/', timestamp: iso(4), like_count: 512, comments_count: 21
          }
        ],
        igReach: 52600
      },
      {
        page: {
          id: 'demo_page_2', name: 'Orbit Dev Tools', category: 'Brand',
          link: 'https://www.facebook.com/', followers_count: 2310, fan_count: 2300, access_token: 'demo'
        },
        posts: [
          {
            message: 'Orbit 2.0 is live', created_time: iso(3),
            reactions: { summary: { total_count: 64 } }, comments: { summary: { total_count: 5 } }
          }
        ],
        insights: {
          page_total_media_view_unique: 12100, page_media_view: 21400, page_post_engagements: 1200
        },
        ig: null,
        igMedia: [],
        igReach: null
      }
    ]
  };
}
