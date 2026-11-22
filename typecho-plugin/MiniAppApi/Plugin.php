<?php
namespace TypechoPlugin\MiniAppApi;

use Typecho\Plugin\PluginInterface;
use Typecho\Widget\Helper\Form;
use Utils\Helper;

if (!defined('__TYPECHO_ROOT_DIR__')) exit;

/**
 * MiniAppApi - 为小程序提供 JSON 数据接口
 *
 * @package MiniAppApi
 * @author workbuddy
 * @version 1.5.8
 * @link https://qq.com
 */
class Plugin implements PluginInterface
{
    /** 路由 Action 的完整类名（Typecho 1.3 命名空间写法） */
    const ACTION = '\\TypechoPlugin\\MiniAppApi\\Action';

    /** 插件注册的全部路由 */
    const ROUTES = array(
        'miniapp-ping'       => array('/api/ping', 'ping'),
        'miniapp-posts'      => array('/api/posts', 'posts'),
        'miniapp-post'       => array('/api/post', 'post'),
        'miniapp-categories' => array('/api/categories', 'categories'),
        'miniapp-config'     => array('/api/config', 'config'),
        'miniapp-archives'   => array('/api/archives', 'archives'),
        'miniapp-hitokoto'   => array('/api/hitokoto', 'hitokoto'),
    );

    public static function activate()
    {
        // 单条路由注册失败不中断启用：中断会显示报错页，且留下"半激活"状态
        foreach (self::ROUTES as $name => $r) {
            try {
                Helper::addRoute($name, $r[0], self::ACTION, $r[1]);
            } catch (\Throwable $e) {
                // 忽略，下次启用会重试
            }
        }

        return 'MiniAppApi 已启用：/api/ping · /api/posts · /api/post · /api/categories · /api/config · /api/archives · /api/hitokoto';
    }

    public static function deactivate()
    {
        foreach (self::ROUTES as $name => $r) {
            try {
                Helper::removeRoute($name);
            } catch (\Throwable $e) {
                // 忽略
            }
        }
    }

    public static function config(Form $form)
    {
        // 读取现有配置回填默认值：重新启用时 Typecho 会用表单值合并覆盖配置，
        // 若直接给硬编码默认值，会把用户已填的 token 等清空
        $current = null;
        try {
            $current = Helper::options()->plugin('MiniAppApi');
        } catch (\Throwable $e) {
            $current = null; // 首次启用时还没有配置
        }

        $val = function ($key, $default) use ($current) {
            if ($current !== null && isset($current->{$key})
                && $current->{$key} !== null && strval($current->{$key}) !== '') {
                return strval($current->{$key});
            }
            return $default;
        };

        $token = new Form\Element\Text(
            'token', null, $val('token', ''), '接口密钥',
            '小程序请求需带 token 参数，留空则不校验'
        );
        $form->addInput($token);

        $excerptLen = new Form\Element\Text(
            'excerptLen', null, $val('excerptLen', '120'), '列表摘要长度',
            '文章列表摘要截取的字符数，默认 120'
        );
        $form->addInput($excerptLen);

        $about = new Form\Element\Textarea(
            'aboutText', null, $val('aboutText', ''), '关于文案',
            '小程序"关于"页展示的内容'
        );
        $form->addInput($about);

        /* ---------- 功能区开关 ---------- */

        $sliderOn = new Form\Element\Radio(
            'featureSlider', array('1' => '开启', '0' => '关闭'), $val('featureSlider', '1'), '首页顶部轮播',
            '开启后小程序首页顶部显示轮播幻灯片，内容自动引用网页端首页轮播'
        );
        $form->addInput($sliderOn);

        $coverOn = new Form\Element\Radio(
            'featureCategoryCover', array('1' => '开启', '0' => '关闭'), $val('featureCategoryCover', '1'), '分类页图片',
            '开启后分类页顶部显示封面大图；文章卡片缩略图取网页端的自定义缩略图'
        );
        $form->addInput($coverOn);

        $archiveOn = new Form\Element\Radio(
            'featureArchive', array('1' => '开启', '0' => '关闭'), $val('featureArchive', '1'), '关于页归档',
            '开启后关于页的「接口状态」换成「归档」入口，可看归档封面、站点统计与按月文章'
        );
        $form->addInput($archiveOn);


        $hitokotoOn = new Form\Element\Radio(
            'featureHitokoto', array('1' => '开启', '0' => '关闭'), $val('featureHitokoto', '1'), '关于页一言卡片',
            '开启后关于页顶部显示一言卡片（问候语 + 日期 + 配图 + 随机句子），关闭则显示文章/分类统计'
        );
        $form->addInput($hitokotoOn);

        $rewardOn = new Form\Element\Radio(
            'featureReward', array('1' => '开启', '0' => '关闭'), $val('featureReward', '1'), '文章页赞赏',
            '开启后文章详情页底部显示「赞赏」按钮，点开弹出赞赏码；没填赞赏码图片时按钮自动隐藏'
        );
        $form->addInput($rewardOn);

        $rewardImage = new Form\Element\Text(
            'rewardImage', null, $val('rewardImage', ''), '赞赏码图片',
            '填图片地址，或服务器上的路径（网址 / /wwwroot/... / usr/uploads/... 都认）。留空则文章页不显示赞赏按钮'
        );
        $form->addInput($rewardImage);

        $linksOn = new Form\Element\Radio(
            'featureLinks', array('1' => '开启', '0' => '关闭'), $val('featureLinks', '1'), '关于页友情链接',
            '开启后关于页底部显示「友情链接」，内容自动抓取网页端 /links.html 的友邻列表（只取链接，不含友链要求），缓存 1 小时'
        );
        $form->addInput($linksOn);

        $hitokotoApi = new Form\Element\Text(
            'hitokotoApi', null, $val('hitokotoApi', ''), '一言接口地址（可选）',
            '留空（推荐）＝不请求任何外部接口，直接读下面的本地诗词文件。填本站地址（如 https://你的域名/yiyan.php）也会自动转成本地读取；只有填外站地址时才会由服务端代理请求一次'
        );
        $form->addInput($hitokotoApi);

        $hitokotoImage = new Form\Element\Text(
            'hitokotoImage', null, $val('hitokotoImage', ''), '一言卡片配图（可选）',
            '可填图片地址，也可填图库目录（目录内随机取一张）。网址、/wwwroot/... 绝对路径、usr/themes/... 相对路径都认。留空则用下面「一言图库目录」随机取图'
        );
        $form->addInput($hitokotoImage);

        $hitokotoDir = new Form\Element\Text(
            'hitokotoDir', null, $val('hitokotoDir', 'usr/themes/HarmonyHues/assets/yiyan'), '一言图库目录',
            '可填相对路径（usr/themes/...）、服务器绝对路径（/wwwroot/...）或完整网址。目录内 webp/jpg/png/gif 会被随机选作卡片配图'
        );
        $form->addInput($hitokotoDir);

        $hitokotoTxt = new Form\Element\Text(
            'hitokotoTxt', null, $val('hitokotoTxt', 'usr/themes/HarmonyHues/assets/yiyan/yiyan.txt'), '本地诗词文件',
            '每行一句：句子——作者《出处》。同样支持网址、绝对路径、相对路径三种写法。这里是卡片的主要句子来源'
        );
        $form->addInput($hitokotoTxt);

        /* ---------- 内容覆盖项（留空即自动引用网页端） ---------- */

        $sliderJson = new Form\Element\Textarea(
            'sliderJson', null, $val('sliderJson', ''), '轮播内容（可选）',
            '留空自动引用网页端首页轮播。也可手填 JSON 数组覆盖：[{"image":"https://…/1.webp","label":"关于主题","title":"个性签名","desc":"描述","link":"https://…"}]'
        );
        $form->addInput($sliderJson);

        $categoryCover = new Form\Element\Text(
            'categoryCover', null, $val('categoryCover', ''), '分类页封面图（可选）',
            '留空自动引用网页端分类页的封面图'
        );
        $form->addInput($categoryCover);

        $archiveCover = new Form\Element\Text(
            'archiveCover', null, $val('archiveCover', ''), '归档页封面图（可选）',
            '留空自动引用网页端 /archives.html 的封面图'
        );
        $form->addInput($archiveCover);
    }

    public static function personalConfig(Form $form) {}
}
