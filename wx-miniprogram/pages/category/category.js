const api = require('../../utils/api');
const cfg = require('../../config');
const client = require('../../utils/client');
const share = require('../../utils/share');
const { decoratePost } = require('../../utils/format');

const app = getApp();

Page({
  data: {
    cats: [],
    activeMid: 0,
    activeName: '全部',
    categoryCover: '',
    posts: [],
    total: 0,
    page: 1,
    hasMore: false,
    loading: false,
    firstLoaded: false,
    error: ''
  },

  onLoad() {
    app.loadSite().then(site => {
      if (site.title) client.setNavigationBarTitle({ title: '分类 · ' + site.title });
      const on = site.features && site.features.categoryCover;
      this.setData({ categoryCover: on ? (site.categoryCover || '') : '' });
    });
    this.loadCats();
    this.reload();
  },

  loadCats() {
    api.getCategories().then(data => {
      const list = data.list || [];
      let sum = 0;
      list.forEach(c => { sum += c.count || 0; });
      const cats = [{ mid: 0, name: '全部', count: sum }].concat(list);
      this.setData({ cats: cats });
    }).catch(() => {
      // 分类接口失败不阻塞文章列表
    });
  },

  onPullDownRefresh() {
    app.loadSite(true).then(site => {
      const on = site.features && site.features.categoryCover;
      this.setData({ categoryCover: on ? (site.categoryCover || '') : '' });
    });
    this.loadCats();
    this.reload().then(() => client.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadPage(false);
    }
  },

  switchCat(e) {
    const mid = parseInt(e.currentTarget.dataset.mid, 10) || 0;
    if (mid === this.data.activeMid) return;
    this.setData({
      activeMid: mid,
      activeName: e.currentTarget.dataset.name || '全部'
    });
    this.reload();
  },

  reload() {
    this.setData({ posts: [], page: 1, hasMore: false, error: '', firstLoaded: false });
    return this.loadPage(true);
  },

  loadPage(reset) {
    if (this.data.loading) return Promise.resolve();
    const page = reset ? 1 : this.data.page;
    const params = { page: page, pageSize: cfg.pageSize };
    if (this.data.activeMid > 0) params.category = this.data.activeMid;

    this.setData({ loading: true, error: '' });

    return api.getPosts(params).then(data => {
      const list = (data.list || []).map(decoratePost);
      const all = reset ? list : this.data.posts.concat(list);
      this.setData({
        posts: all,
        total: data.total || 0,
        page: page + 1,
        hasMore: !!data.hasMore,
        loading: false,
        firstLoaded: true
      });
      if (reset && list.length) {
        client.pageScrollTo({ scrollTop: 0, duration: 0 });
      }
      // 转发封面：预裁剪当前分类第一篇的缩略图（5:4）
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

  goDetail(e) {
    client.navigateTo({ url: '/packagePost/pages/detail/detail?id=' + e.detail.cid });
  },

  onShareAppMessage() {
    const site = getApp().globalData.site || {};
    const res = {
      title: (site.title ? '分类 · ' + site.title : '文章分类'),
      path: '/pages/category/category'
    };
    const cover = this._shareSrc ? share.coverFor(this._shareSrc) : '';
    if (cover) res.imageUrl = cover;
    return res;
  }
});
