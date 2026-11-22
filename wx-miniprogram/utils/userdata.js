// 用户数据层：登录态 + 收藏 + 浏览记录（全部走 cloud.database，身份由 RLS 隔离）
const { cloud } = require('./cloud');

/** 获取当前登录会话；未登录返回 null */
function getSession() {
  return cloud.auth.getSession().then(res => {
    return res.error ? null : (res.data || null);
  }).catch(() => null);
}

/** 发送邮箱验证码（登录/注册共用） */
function sendEmailCode(email) {
  return cloud.auth.sendOtp({ email: email });
}

/** 提交验证码完成登录/注册；成功返回 session */
function submitEmailOtp(pending, code) {
  return cloud.auth.verifyOtp({
    email: pending.email,
    verificationId: pending.verificationId,
    isExistingUser: pending.isExistingUser,
    token: code
  });
}

function signOut() {
  return cloud.auth.signOut();
}

/** 收藏一篇（幂等：按 owner_id+post_id 冲突合并，重复收藏只保留一条） */
function addFavorite(post, ownerName) {
  return cloud.database.from('favorites')
    .insert({
      post_id: Number(post.cid),
      title: post.title || '',
      slug: post.slug || null,
      thumb: post.thumb || null,
      owner_name: ownerName || null
    }, { ignoreDuplicates: true, onConflict: 'owner_id,post_id' })
    .select();
}

/** 取消收藏 */
function removeFavorite(postId) {
  return cloud.database.from('favorites')
    .delete()
    .eq('post_id', Number(postId))
    .select();
}

/** 是否已收藏某篇 */
function isFavorite(postId) {
  return cloud.database.from('favorites')
    .select('id')
    .eq('post_id', Number(postId))
    .maybeSingle()
    .then(res => ({ data: !!res.data, error: res.error }));
}

/** 收藏列表（新→旧） */
function listFavorites(limit) {
  return cloud.database.from('favorites')
    .select('id, post_id, title, slug, thumb, created_at')
    .order('created_at', { ascending: false })
    .limit(limit || 50);
}

/** 记录浏览（幂等：按 owner_id+post_id 冲突合并，重复阅读刷新 read_at）
 *  关键：upsert 必须显式 onConflict，否则服务端按主键 id 合并，
 *  而写入不带 id，等于每次都新插一行，旧记录的 read_at 永远不更新。 */
function recordHistory(post) {
  const row = {
    post_id: Number(post.cid),
    title: post.title || '',
    slug: post.slug || null,
    thumb: post.thumb || null,
    read_at: new Date().toISOString()
  };
  return cloud.database.from('reading_history')
    .upsert(row, { onConflict: 'owner_id,post_id' })
    .then(res => {
      if (res && !res.error) return res;
      // 兜底：服务端不支持 on_conflict 时退化为「删旧 + 插新」
      return cloud.database.from('reading_history')
        .delete()
        .eq('post_id', row.post_id)
        .then(() => cloud.database.from('reading_history').insert(row).select());
    });
}

/** 浏览记录（新→旧） */
function listHistory(limit) {
  return cloud.database.from('reading_history')
    .select('id, post_id, title, slug, thumb, read_at')
    .order('read_at', { ascending: false })
    .limit(limit || 20);
}

/** 清空浏览记录 */
function clearHistory() {
  return cloud.database.from('reading_history').delete().select();
}

module.exports = {
  getSession: getSession,
  sendEmailCode: sendEmailCode,
  submitEmailOtp: submitEmailOtp,
  signOut: signOut,
  addFavorite: addFavorite,
  removeFavorite: removeFavorite,
  isFavorite: isFavorite,
  listFavorites: listFavorites,
  recordHistory: recordHistory,
  listHistory: listHistory,
  clearHistory: clearHistory
};
