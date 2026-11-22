const api = require('../../../utils/api');
const cfg = require('../../../config');
const client = require('../../../utils/client');
const md = require('../../utils/markdown');
const ud = require('../../../utils/userdata');
const share = require('../../../utils/share');
const poster = require('../../utils/poster');
const { readingStats } = require('../../../utils/format');

/** 摘要：优先截到句末标点，避免出现「…古人」这种半句 */
function excerptOf(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const cut = Math.max(
    head.lastIndexOf('。'), head.lastIndexOf('！'),
    head.lastIndexOf('？'), head.lastIndexOf('；')
  );
  return (cut > max * 0.45 ? head.slice(0, cut + 1) : head) + '…';
}

Page({
  data: {
    post: null,
    blocks: [],
    images: [],
    stats: { chars: 0, minutes: 1 },
    loading: true,
    error: '',
    percent: 0,
    barStyle: 'width:0%',
    showTop: false,
    faved: false,
    faving: false,
    posterPath: '',
    posterMaking: false,
    // 赞赏（插件开关控制；没配赞赏码时按钮不显示）
    rewardOn: false,
    rewardImage: '',
    rewardShow: false,
    // 分享卡片
    shareShow: false,
    shareUrl: ''
  },

  onLoad(options) {
    this.cid = options.id || '';
    this.slug = options.slug || '';
    this.articleHeight = 0;
    this.windowHeight = 0;
    const sys = client.getSystemInfoSync ? client.getSystemInfoSync() : null;
    if (sys) this.windowHeight = sys.windowHeight;
    this.load();
    this.syncSite();
  },

  /** 读站点配置：赞赏按钮是否显示、赞赏码地址（force=绕过内存缓存，后台刚配好也能生效） */
  syncSite(force) {
    const app = getApp();
    if (!app || !app.loadSite) return;
    app.loadSite(force).then(site => {
      if (!site) return;
      const f = site.features || {};
      const img = site.rewardImage || '';
      this.setData({
        rewardOn: !!(f.reward && img),
        rewardImage: img
      });
    });
  },

  onShow() {
    // 上次没拿到赞赏码时再拉一次，避免后台刚配好却要重启小程序
    if (!this.data.rewardImage) this.syncSite(true);
  },

  load() {
    if (!this.cid && !this.slug) {
      this.setData({ loading: false, error: '缺少文章参数' });
      return Promise.resolve();
    }
    this.setData({ loading: true, error: '' });
    const params = this.cid ? { id: this.cid } : { slug: this.slug };

    return api.getPost(params).then(data => {
      const blocks = md.parse(data.content, { base: cfg.apiBase })
        .map((b, i) => Object.assign({}, b, { key: i }));
      const images = md.images(blocks);
      const plain = md.plainText(blocks);
      const stats = readingStats(plain);
      this.excerpt = excerptOf(plain, 96);

      this.setData({
        post: data,
        blocks: blocks,
        images: images,
        stats: stats,
        shareUrl: poster.urlOf(data),
        loading: false
      });
      client.setNavigationBarTitle({ title: data.title || '文章' });
      this.measure();
      this.syncCloud(data);
      // 预裁剪分享封面（缩略图 → 5:4）；没有缩略图时退回正文首图
      this.shareFallback = (images && images[0]) || '';
      share.prepareCover(data.thumb || this.shareFallback);
    }).catch(err => {
      this.setData({ loading: false, error: err.message || '文章加载失败' });
    });
  },

  /** 云端同步：已登录则记浏览 + 查收藏状态 */
  syncCloud(post) {
    ud.getSession().then(session => {
      if (!session) return;
      ud.recordHistory(post).catch(() => {});
      ud.isFavorite(post.cid).then(res => {
        if (!res.error) {
          this.setData({ faved: res.data });
        }
      });
    });
  },

  /** 收藏 / 取消收藏 */
  onToggleFav() {
    const post = this.data.post;
    if (!post || this.data.faving) return;

    ud.getSession().then(session => {
      if (!session) {
        client.showToast({ title: '请先到「我的」页登录', icon: 'none' });
        return;
      }
      this.setData({ faving: true });
      const call = this.data.faved
        ? ud.removeFavorite(post.cid)
        : ud.addFavorite(post, session.user && session.user.name);

      call.then(res => {
        if (res && res.error) {
          client.showToast({ title: res.error.message || '操作失败', icon: 'none' });
        } else {
          this.setData({ faved: !this.data.faved });
          client.showToast({
            title: this.data.faved ? '已收藏' : '已取消收藏',
            icon: 'none'
          });
        }
        this.setData({ faving: false });
      }).catch(() => {
        this.setData({ faving: false });
        client.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
      });
    });
  },

  /** 测量正文高度，用于计算阅读进度 */
  measure() {
    if (!client.createSelectorQuery) return;
    setTimeout(() => {
      client.createSelectorQuery()
        .select('#article')
        .boundingClientRect(rect => {
          if (rect && rect.height) {
            this.articleHeight = rect.height;
          }
        })
        .exec();
    }, 300);
  },

  onPageScroll(e) {
    const scrollTop = e.scrollTop || 0;
    const showTop = scrollTop > 900;
    const sys = this.windowHeight
      || (client.getSystemInfoSync ? client.getSystemInfoSync().windowHeight : 0);

    // 高度还没测量出来时不更新百分比，避免进度条瞬间跳到 100%
    let percent = this.data.percent;
    if (this.articleHeight && this.articleHeight > sys) {
      percent = Math.min(100, Math.round((scrollTop / (this.articleHeight - sys)) * 100));
    }

    if (percent !== this.data.percent || showTop !== this.data.showTop) {
      this.setData({ percent: percent, barStyle: 'width:' + percent + '%', showTop: showTop });
    }
  },

  /** 图片预览：以全文图片为相册 */
  onPreview(e) {
    const src = e.currentTarget.dataset.src;
    if (!src) return;
    const urls = this.data.images.length ? this.data.images : [src];
    client.previewImage({ current: src, urls: urls });
  },

  onBackTop() {
    client.pageScrollTo({ scrollTop: 0, duration: 300 });
  },

  /** 生成分享海报并弹出预览 */
  onMakePoster() {
    const post = this.data.post;
    if (!post || this.data.posterMaking) return;
    this.setData({ posterMaking: true });
    client.showLoading({ title: '海报生成中', mask: true });

    poster.generate(post, {
      cover: post.thumb || this.shareFallback || ''
    }).then(path => {
      client.hideLoading();
      this.setData({ posterMaking: false, posterPath: path });
    }).catch(err => {
      client.hideLoading();
      this.setData({ posterMaking: false });
      client.showToast({
        title: (err && err.message) || '海报生成失败',
        icon: 'none'
      });
    });
  },

  /** 海报保存到相册 */
  onPosterSave() {
    const path = this.data.posterPath;
    if (!path || this.posterSaving) return;
    this.posterSaving = true;
    poster.save(path, this.data.post).then(res => {
      this.posterSaving = false;
      // 开发者工具里已用弹窗说明过，不再重复提示
      if (res && res.devtools) return;
      client.showToast({ title: '已保存到相册', icon: 'success' });
    }).catch(err => {
      this.posterSaving = false;
      const msg = (err && err.errMsg) || '';
      // 用户主动取消授权时不打扰
      if (msg.indexOf('cancel') > -1) return;
      client.showToast({
        title: msg ? '保存失败：' + msg.replace(/^saveImageToPhotosAlbum:fail\s*/, '') : '保存失败',
        icon: 'none'
      });
    });
  },

  onClosePoster() {
    this.posterSaving = false;
    this.setData({ posterPath: '' });
  },

  /* ---------------- 赞赏 / 分享 ---------------- */

  onOpenReward() {
    if (!this.data.rewardImage) {
      client.showToast({ title: '还没有配置赞赏码', icon: 'none' });
      return;
    }
    this.setData({ rewardShow: true });
  },

  onCloseReward() {
    this.setData({ rewardShow: false });
  },

  /** 赞赏码点开看大图，方便长按识别 */
  onPreviewReward() {
    if (!this.data.rewardImage) return;
    client.previewImage({ urls: [this.data.rewardImage] });
  },

  onOpenShare() {
    if (!this.data.shareUrl && this.data.post) {
      this.setData({ shareUrl: poster.urlOf(this.data.post) });
    }
    this.setData({ shareShow: true });
  },

  onCloseShare() {
    this.setData({ shareShow: false });
  },

  /** 复制文章网页地址 */
  onCopyLink() {
    const url = this.data.shareUrl;
    if (!url) {
      client.showToast({ title: '链接还没准备好', icon: 'none' });
      return;
    }
    client.setClipboardData({
      data: url,
      success: () => {
        this.setData({ shareShow: false });
        client.showToast({ title: '链接已复制', icon: 'none' });
      },
      fail: () => {
        client.showToast({ title: '复制失败，请手动选择', icon: 'none' });
      }
    });
  },

  /** 点击海报看大图（可双指放大） */
  onPreviewPoster() {
    if (!this.data.posterPath) return;
    client.previewImage({ urls: [this.data.posterPath] });
  },

  noop() {},

  onShareAppMessage() {
    const post = this.data.post;
    const src = post ? (post.thumb || this.shareFallback) : '';
    const cover = src ? share.coverFor(src) : '';
    const res = {
      title: post ? post.title : '文章分享',
      path: '/packagePost/pages/detail/detail?id=' + (post ? post.cid : '')
    };
    if (cover) res.imageUrl = cover;
    return res;
  }
});
