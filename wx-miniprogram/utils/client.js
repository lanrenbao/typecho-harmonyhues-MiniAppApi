// 运行环境全局对象：QQ 小程序为 qq，微信为 wx
module.exports = (typeof qq !== 'undefined') ? qq : (typeof wx !== 'undefined' ? wx : {});
