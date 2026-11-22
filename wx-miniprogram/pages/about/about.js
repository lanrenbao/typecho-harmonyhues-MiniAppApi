const api = require('../../utils/api');
const cfg = require('../../config');
const client = require('../../utils/client');
const { number } = require('../../utils/format');

const app = getApp();

Page({
  data: {
    site: { title: '', description: '', about: '' },
    features: { archive: false, hitokoto: false },
    greeting: '',
    day: '',
    month: '',
    hitokoto: { text: '', from: '', fromWho: '' },
    hitokotoImage: '',
    hitokotoLoading: false,
    aboutText: '',
    catCount: 0,
    postCount: 0,
    postCountText: '',
    health: { state: 'checking', text: '检查中…' },
    // 友情链接
    groups: [],
    linkShow: false,
    link: { name: '', url: '', desc: '', avatar: '' },
    base: cfg.apiBase,
    version: '2.0.0'
  },

  onLoad() {
    this.setData(this._nowInfo());

    app.loadSite().then(site => {
      const features = site.features || { archive: false, hitokoto: false };
      this.setData({
        site: site,
        features: features,
        aboutText: (site.about || '').trim(),
        hitokotoImage: site.hitokotoImage || '',
        groups: this._groupLinks(site.links)
      });
      if (site.title) client.setNavigationBarTitle({ title: '关于' });
      // 归档开启时不需要接口状态面板，省掉一次探活请求
      if (!features.archive) this.checkHealth();
      if (features.hitokoto) this.loadHitokoto();
    });
    this.loadStats();
  },

  onPullDownRefresh() {
    const done = () => client.stopPullDownRefresh();
    // 顺便刷新站点配置，后台加了友链下拉就能看到
    app.loadSite(true).then(site => {
      if (site) this.setData({ groups: this._groupLinks(site.links) });
    }).catch(() => {});
    if (this.data.features.hitokoto) {
      this.loadHitokoto().then(done, done);
    } else {
      done();
    }
  },

  /* ---------------- 友情链接 ---------------- */

  /** 服务端给的是分组结构，这里补一个首字用于头像缺失时兜底 */
  _groupLinks(links) {
    const groups = (links && links.groups) || [];
    return groups.map(g => ({
      name: g.name || '友情链接',
      items: (g.items || []).map(it => ({
        name: it.name || '',
        url: it.url || '',
        desc: it.desc || '',
        avatar: it.avatar || '',
        initial: String(it.name || '?').trim().slice(0, 1)
      }))
    })).filter(g => g.items.length);
  },

  onOpenLink(e) {
    const d = e.currentTarget.dataset || {};
    this.setData({
      linkShow: true,
      link: {
        name: d.name || '',
        url: d.url || '',
        desc: d.desc || '',
        avatar: d.avatar || ''
      }
    });
  },

  onCloseLink() {
    this.setData({ linkShow: false });
  },

  onCopyLinkUrl() {
    const url = this.data.link.url;
    if (!url) return;
    client.setClipboardData({
      data: url,
      success: () => {
        this.setData({ linkShow: false });
        client.showToast({ title: '网址已复制', icon: 'none' });
      }
    });
  },

  noop() {},

  /* ---------------- 一言卡片 ---------------- */

  /** 按当前时间算问候语与日期（22 / 11 这种不带前导零的写法） */
  _nowInfo() {
    const d = new Date();
    const h = d.getHours();
    let greeting = '晚上好，愿你今夜安眠！';
    if (h >= 23 || h < 5) greeting = '夜深了，早点休息哦！';
    else if (h < 9) greeting = '早安，新的一天开始啦！';
    else if (h < 12) greeting = '上午好，今天也要加油！';
    else if (h < 14) greeting = '午安，记得小憩一会儿！';
    else if (h < 18) greeting = '下午好，喝杯茶歇一歇！';
    return {
      greeting: greeting,
      day: String(d.getDate()),
      month: String(d.getMonth() + 1)
    };
  },

  loadHitokoto() {
    if (this._hitoBusy) return Promise.resolve();
    this._hitoBusy = true;
    this.setData({ hitokotoLoading: true });
    return api.getHitokoto().then(data => {
      this._hitoBusy = false;
      this.setData({
        hitokotoLoading: false,
        hitokoto: {
          text: (data && data.text) || '此心安处是吾乡。',
          from: (data && data.from) || '',
          fromWho: (data && data.fromWho) || ''
        },
        hitokotoImage: (data && data.image) || this.data.hitokotoImage || ''
      });
    }).catch(() => {
      this._hitoBusy = false;
      this.setData({
        hitokotoLoading: false,
        hitokoto: { text: '山有木兮木有枝，心悦君兮君不知。', from: '越人歌', fromWho: '' }
      });
    });
  },

  refreshHitokoto() {
    if (this.data.hitokotoLoading) return;
    this.loadHitokoto().then(() => {
      client.showToast({ title: '已换一句', icon: 'none' });
    });
  },

  goArchive() {
    client.navigateTo({ url: '/packagePost/pages/archive/archive' });
  },

  loadStats() {
    api.getCategories().then(data => {
      const list = data.list || [];
      let sum = 0;
      list.forEach(c => { sum += c.count || 0; });
      this.setData({
        catCount: list.length,
        postCount: sum,
        postCountText: number(sum)
      });
    }).catch(() => {});
  },

  checkHealth() {
    const started = Date.now();
    api.ping().then(data => {
      this.setData({
        health: {
          state: 'ok',
          text: '连接正常',
          typecho: data.typecho || '-',
          php: data.php || '-',
          plugin: data.version || '-',
          ms: Date.now() - started
        }
      });
    }).catch(err => {
      this.setData({
        health: { state: 'fail', text: err.message || '连接失败' }
      });
    });
  },

  onShareAppMessage() {
    return {
      title: this.data.site.title || '关于',
      path: '/pages/index/index'
    };
  }
});
