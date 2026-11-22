const api = require('./utils/api');
const cfg = require('./config');

App({
  globalData: {
    // 站点信息在启动时预取，各页面直接读，避免每页重复请求
    site: {
      title: cfg.fallbackTitle,
      description: '',
      about: '',
      // 老版本插件没有 features 字段，一律按关闭处理，避免出现空壳模块
      features: { slider: false, categoryCover: false, archive: false, hitokoto: false, reward: false, links: false },
      slider: [],
      categoryCover: '',
      rewardImage: '',
      links: { groups: [] }
    },
    siteReady: false
  },

  onLaunch() {
    this.loadSite();
  },

  /** 获取站点信息（带并发去重与失败兜底） */
  loadSite(force) {
    if (this._sitePromise) return this._sitePromise;
    if (this.globalData.siteReady && !force) {
      return Promise.resolve(this.globalData.site);
    }
    this._sitePromise = api.getConfig().then(data => {
      const f = data.features || {};
      this.globalData.site = {
        title: data.title || cfg.fallbackTitle,
        description: data.description || '',
        about: data.about || '',
        features: {
          slider: !!f.slider,
          categoryCover: !!f.categoryCover,
          archive: !!f.archive,
          hitokoto: !!f.hitokoto,
          reward: !!f.reward,
          links: !!f.links
        },
        slider: Array.isArray(data.slider) ? data.slider : [],
        categoryCover: data.categoryCover || '',
        hitokotoImage: data.hitokotoImage || '',
        rewardImage: data.rewardImage || '',
        links: data.links || { groups: [] }
      };
      this.globalData.siteReady = true;
      this._sitePromise = null;
      return this.globalData.site;
    }).catch(() => {
      this._sitePromise = null;
      return this.globalData.site;
    });
    return this._sitePromise;
  }
});
