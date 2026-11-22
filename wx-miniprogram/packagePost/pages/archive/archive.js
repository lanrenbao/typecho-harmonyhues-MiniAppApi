const api = require('../../../utils/api');
const client = require('../../../utils/client');

Page({
  data: {
    cover: '',
    stats: null,
    statItems: [],
    groups: [],
    total: 0,
    loading: true,
    error: ''
  },

  onLoad() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => client.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true, error: '' });
    return api.getArchives().then(data => {
      const stats = data.stats || null;
      this.setData({
        cover: data.cover || '',
        stats: stats,
        statItems: stats ? [
          { key: 'posts', chars: ['文', '章'], value: stats.posts || 0, unit: '篇' },
          { key: 'categories', chars: ['分', '类'], value: stats.categories || 0, unit: '个' },
          { key: 'pages', chars: ['页', '面'], value: stats.pages || 0, unit: '个' },
          { key: 'comments', chars: ['评', '论'], value: stats.comments || 0, unit: '条' },
          { key: 'tags', chars: ['标', '签'], value: stats.tags || 0, unit: '个' },
          { key: 'days', chars: ['建', '站'], value: stats.days || 0, unit: '天' }
        ] : [],
        groups: data.groups || [],
        total: data.total || 0,
        loading: false
      });
    }).catch(err => {
      this.setData({
        loading: false,
        error: (err && err.message) || '归档加载失败'
      });
    });
  },

  goDetail(e) {
    const cid = e.currentTarget.dataset.cid;
    if (!cid) return;
    client.navigateTo({ url: '/packagePost/pages/detail/detail?id=' + cid });
  },

  onShareAppMessage() {
    return {
      title: '归档',
      path: '/packagePost/pages/archive/archive'
    };
  }
});
