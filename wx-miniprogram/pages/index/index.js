const api = require('../../utils/api');
const cfg = require('../../config');
const client = require('../../utils/client');
const share = require('../../utils/share');
const { decoratePost, number } = require('../../utils/format');

const app = getApp();

Page({
  data: {
    site: { title: '', description: '' },
    slider: [],
    posts: [],
    total: 0,
    totalText: '',
    page: 1,
    hasMore: false,
    loading: false,
    firstLoaded: false,
    error: '',
    q: ''
  },

  onLoad() {
    app.loadSite().then(site => {
      this.setData({ site: site, slider: site.slider || [] });
      if (site.title) {
        client.setNavigationBarTitle({ title: site.title });
      }
    });
    this.reload();
  },

  onPullDownRefresh() {
    // 下拉时顺带刷新站点配置，插件后台开关/轮播改动能即时生效
    app.loadSite(true).then(site => {
      this.setData({ site: site, slider: site.slider || [] });
    });
    this.reload().then(() => client.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadPage(false);
    }
  },

  reload() {
    this.setData({ posts: [], page: 1, hasMore: false, error: '', firstLoaded: false });
    return this.loadPage(true);
  },

  loadPage(reset) {
    if (this.data.loading) return Promise.resolve();
    const page = reset ? 1 : this.data.page;
    const params = { page: page, pageSize: cfg.pageSize };
    if (this.data.q) params.q = this.data.q;

    this.setData({ loading: true, error: '' });

    return api.getPosts(params).then(data => {
      const list = (data.list || []).map(decoratePost);
      const all = reset ? list : this.data.posts.concat(list);
      this.setData({
        posts: all,
        total: data.total || 0,
        totalText: number(data.total || 0),
        page: page + 1,
        hasMore: !!data.hasMore,
        loading: false,
        firstLoaded: true
      });
      if (reset && list.length) {
        client.pageScrollTo({ scrollTop: 0, duration: 0 });
      }
      // 转发封面：预裁剪当前列表第一篇的缩略图（5:4）
      if (reset) this._shareSrc = '';
      const first = all[0];
      if (first && first.thumb && first.thumb !== this._shareSrc) {
        this._shareSrc = first.thumb;
        share.prepareCover(first.thumb);
      }
    }).catch(err => {
      this.setData({
        loading: false,
        firstLoaded: true,
        error: err.message || '加载失败'
      });
    });
  },

  onSearch(e) {
    this.setData({ q: (e.detail.value || '').trim() });
    this.reload();
  },

  onClearSearch() {
    this.setData({ q: '' });
    this.reload();
  },

  goDetail(e) {
    client.navigateTo({ url: '/packagePost/pages/detail/detail?id=' + e.detail.cid });
  },

  /** 轮播点击：站内文章直接进详情，其他链接复制到剪贴板 */
  onSliderTap(e) {
    const item = this.data.slider[e.currentTarget.dataset.index];
    const link = item && item.link;
    if (!link) return;

    const m = link.match(/\/archives\/([^/?#]+?)\.html/i);
    if (m) {
      const key = decodeURIComponent(m[1]);
      const url = /^\d+$/.test(key)
        ? '/packagePost/pages/detail/detail?id=' + key
        : '/packagePost/pages/detail/detail?slug=' + encodeURIComponent(key);
      client.navigateTo({ url: url });
      return;
    }

    client.setClipboardData({
      data: link,
      success() {
        client.showToast({ title: '链接已复制，可在浏览器打开', icon: 'none' });
      }
    });
  },

  onShareAppMessage() {
    const res = {
      title: this.data.site.title || '我的博客',
      path: '/pages/index/index'
    };
    const cover = this._shareSrc ? share.coverFor(this._shareSrc) : '';
    if (cover) res.imageUrl = cover;
    return res;
  }
});
