const ud = require('../../utils/userdata');
const client = require('../../utils/client');

Page({
  data: {
    session: null,
    avatarChar: '读',
    loading: true,
    // 登录表单
    email: '',
    code: '',
    sending: false,
    submitting: false,
    sendCountdown: 0,
    loginError: '',
    // 数据
    favorites: [],
    history: [],
    tab: 'fav',
    favLoading: false,
    historyLoading: false,
    listError: '',
    clearing: false
  },

  onLoad() {
    this._pendingOtp = null;
    this._timer = null;
    this.restoreSession();
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer);
  },

  onShow() {
    if (this.data.session) {
      this.refreshLists();
    }
  },

  /** 下拉手动同步：两个列表都拉云端最新数据 */
  onPullDownRefresh() {
    if (!this.data.session) {
      wx.stopPullDownRefresh();
      return;
    }
    Promise.all([
      this.loadFavorites(),
      this.loadHistory()
    ]).catch(() => null).then(() => wx.stopPullDownRefresh());
  },

  /** 恢复已有会话 */
  restoreSession() {
    ud.getSession().then(session => {
      this.setData({ session: session, avatarChar: this.pickAvatarChar(session), loading: false });
      if (session) this.refreshLists();
    });
  },

  /** 取昵称首字作为头像文字（WXML 不支持对括号表达式取下标） */
  pickAvatarChar(session) {
    var name = session && session.user && session.user.name ? String(session.user.name) : '';
    return name ? name.charAt(0) : '读';
  },

  /* ---------------- 登录 ---------------- */

  onEmailInput(e) {
    this.setData({ email: e.detail.value.trim(), loginError: '' });
  },

  onCodeInput(e) {
    this.setData({ code: e.detail.value.trim(), loginError: '' });
  },

  /** 获取验证码 */
  onSendCode() {
    const email = this.data.email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.setData({ loginError: '请输入正确的邮箱地址' });
      return;
    }
    if (this.data.sending) return;
    this.setData({ sending: true, loginError: '' });

    ud.sendEmailCode(email).then(res => {
      if (res.error) {
        this.setData({ sending: false, loginError: res.error.message || '验证码发送失败' });
        return;
      }
      // 保存验证挑战，提交时复用（不在提交时再发码）
      this._pendingOtp = {
        email: email,
        verificationId: res.data.verificationId,
        isExistingUser: res.data.isExistingUser
      };
      this.startCountdown();
      client.showToast({
        title: '验证码已发送，请查收邮箱',
        icon: 'none'
      });
    }).catch(() => {
      this.setData({ sending: false, loginError: '网络异常，请稍后重试' });
    });
  },

  startCountdown() {
    let left = 60;
    this.setData({ sending: false, sendCountdown: left });
    this._timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(this._timer);
        this._timer = null;
        this.setData({ sendCountdown: 0 });
      } else {
        this.setData({ sendCountdown: left });
      }
    }, 1000);
  },

  /** 提交验证码登录/注册 */
  onSubmit() {
    const pending = this._pendingOtp;
    if (!pending || pending.email !== this.data.email) {
      this.setData({ loginError: '请先获取当前邮箱的验证码' });
      return;
    }
    if (!this.data.code) {
      this.setData({ loginError: '请输入验证码' });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true, loginError: '' });

    ud.submitEmailOtp(pending, this.data.code).then(res => {
      if (res.error) {
        // 验证失败不复用挑战之外发新码，允许重试
        this.setData({ submitting: false, loginError: res.error.message || '验证失败，请检查验证码' });
        return;
      }
      this._pendingOtp = null;
      const session = res.data;
      this.setData({
        submitting: false,
        session: session,
        avatarChar: this.pickAvatarChar(session),
        email: '',
        code: ''
      });
      client.showToast({ title: '登录成功', icon: 'success' });
      this.refreshLists();
    }).catch(() => {
      this.setData({ submitting: false, loginError: '网络异常，请稍后重试' });
    });
  },

  onLogout() {
    ud.signOut().then(() => {
      this.setData({ session: null, favorites: [], history: [], listError: '' });
    });
  },

  /* ---------------- 数据 ---------------- */

  refreshLists() {
    if (this.data.tab === 'fav') {
      this.loadFavorites();
    } else {
      this.loadHistory();
    }
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    this.setData({ tab: tab, listError: '' });
    this.refreshLists();
  },

  loadFavorites() {
    this.setData({ favLoading: true, listError: '' });
    return ud.listFavorites(50).then(res => {
      if (res.error) {
        this.setData({ favLoading: false, listError: res.error.message || '收藏加载失败' });
        return;
      }
      this.setData({ favLoading: false, favorites: this.decorate(res.data || []) });
    }).catch(() => {
      this.setData({ favLoading: false, listError: '网络异常，请稍后重试' });
    });
  },

  loadHistory() {
    this.setData({ historyLoading: true, listError: '' });
    return ud.listHistory(20).then(res => {
      if (res.error) {
        this.setData({ historyLoading: false, listError: res.error.message || '记录加载失败' });
        return;
      }
      this.setData({ historyLoading: false, history: this.decorate(res.data || []) });
    }).catch(() => {
      this.setData({ historyLoading: false, listError: '网络异常，请稍后重试' });
    });
  },

  decorate(rows) {
    return (rows || []).map(r => {
      const when = r.created_at || r.read_at;
      return Object.assign({}, r, {
        whenText: this.fmtTime(when)
      });
    });
  },

  fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = n => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  },

  onOpenPost(e) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;
    const path = '/packagePost/pages/detail/detail?id=' + item.post_id;
    client.navigateTo({ url: path });
  },

  onToggleFav(e) {
    const item = e.currentTarget.dataset.item;
    if (!item || this.data.tab !== 'fav') return;
    ud.removeFavorite(item.post_id).then(() => {
      client.showToast({ title: '已取消收藏', icon: 'none' });
      this.loadFavorites();
    });
  },

  onClearHistory() {
    if (this.data.clearing) return;
    wx.showModal({
      title: '清空浏览记录',
      content: '将删除全部浏览记录，此操作不可恢复。',
      confirmText: '清空',
      confirmColor: '#B54A34',
      success: res => {
        if (!res.confirm) return;
        this.setData({ clearing: true });
        ud.clearHistory().then(() => {
          this.setData({ clearing: false, history: [] });
          client.showToast({ title: '已清空', icon: 'success' });
        }).catch(() => {
          this.setData({ clearing: false });
          client.showToast({ title: '清空失败，请重试', icon: 'none' });
        });
      }
    });
  }
});
