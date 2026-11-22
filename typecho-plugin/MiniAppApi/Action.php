<?php
namespace TypechoPlugin\MiniAppApi;

use Typecho\Widget;
use Typecho\Db;
use Widget\Options;

if (!defined('__TYPECHO_ROOT_DIR__')) exit;

/**
 * JSON 接口实现
 * 路由由 Plugin::activate() 注册，指向本类的命名空间全名
 */
class Action extends Widget
{
    const PLUGIN_VERSION = '1.5.8';

    /** @var Db */
    private $_db;

    /** @var object 插件配置 */
    private $_cfg;

    /** @var string 站点根地址，用于补全相对图片路径 */
    private $_siteUrl = '';

    /** @var array 本次请求中发现缺缓存、待后台下载的友链头像 */
    private $_pendingAvatars = array();

    public function execute() {}

    /* ---------------- 对外接口 ---------------- */

    /** 探活：不查库，用于确认路由与插件加载正常 */
    public function ping()
    {
        $this->_cors();
        $this->_json(array('code' => 0, 'data' => array(
            'plugin' => 'MiniAppApi',
            'version' => self::PLUGIN_VERSION,
            'php' => PHP_VERSION,
            'typecho' => class_exists('\Typecho\Common') ? \Typecho\Common::VERSION : 'unknown',
            'time' => date('Y-m-d H:i:s'),
        )));
    }

    public function posts()
    {
        $this->_guard(array($this, '_posts'));
    }

    private function _posts()
    {
        $this->_boot();
        $page       = max(1, intval($this->_param('page', 1)));
        $pageSize   = min(30, max(1, intval($this->_param('pageSize', 10))));
        $mid        = intval($this->_param('category', 0));
        $q          = trim(strval($this->_param('q', '')));
        $excerptLen = $this->_excerptLen();

        // 分类下没有文章时直接返回空，避免无谓查询
        $cids = array();
        if ($mid > 0) {
            $cids = $this->_cidsOfCategory($mid);
            if (empty($cids)) {
                $this->_json(array('code' => 0, 'data' => array(
                    'list' => array(), 'total' => 0, 'page' => $page,
                    'pageSize' => $pageSize, 'hasMore' => false,
                )));
                return;
            }
        }

        // 计数只取 cid，避免把正文全拉一遍
        $countQuery = $this->_baseQuery('cid', $cids, $q);
        $total = count($this->_db->fetchAll($countQuery));

        $listQuery = $this->_baseQuery('cid, title, slug, created, commentsNum, text', $cids, $q)
            ->order('created', Db::SORT_DESC)
            ->page($page, $pageSize);
        $rows = $this->_db->fetchAll($listQuery);

        $thumbMap = $this->_fieldMapOf(array_map('intval', array_column($rows, 'cid')), 'thumb');
        $list = array();
        foreach ($rows as $row) {
            $cid = intval($row['cid']);
            $list[] = $this->_briefItem($row, $excerptLen,
                isset($thumbMap[$cid]) ? $thumbMap[$cid] : '');
        }

        $this->_json(array('code' => 0, 'data' => array(
            'list'     => $list,
            'total'    => $total,
            'page'     => $page,
            'pageSize' => $pageSize,
            'hasMore'  => $page * $pageSize < $total,
        )));
    }

    public function post()
    {
        $this->_guard(array($this, '_post'));
    }

    private function _post()
    {
        $this->_boot();
        $cid  = intval($this->_param('id', 0));
        $slug = trim(strval($this->_param('slug', '')));

        if ($cid <= 0 && $slug === '') {
            $this->_fail('缺少文章 id 或 slug 参数');
        }

        $select = $this->_db->select('cid', 'title', 'slug', 'created', 'modified',
                'text', 'commentsNum', 'password')
            ->from('table.contents')
            ->where('type = ?', 'post')
            ->where('status = ?', 'publish')
            ->where('password IS NULL OR password = ?', '')
            ->limit(1);

        if ($cid > 0) {
            $select->where('cid = ?', $cid);
        } else {
            $select->where('slug = ?', $slug);
        }

        $row = $this->_db->fetchRow($select);
        if (!$row) {
            $this->_fail('文章不存在或未公开');
        }

        $item = $this->_briefItem($row, $this->_excerptLen(), $this->_fieldOf($row['cid'], 'thumb'));
        $item['content']    = strval($row['text']);
        $item['modified']   = intval($row['modified']);
        $item['categories'] = $this->_metasOf($row['cid'], 'category');
        $item['tags']       = $this->_metasOf($row['cid'], 'tag');

        $this->_json(array('code' => 0, 'data' => $item));
    }

    public function categories()
    {
        $this->_guard(array($this, '_categories'));
    }

    private function _categories()
    {
        $this->_boot();
        // order 是 MySQL 保留字，不写进 SQL，按 mid 升序即可
        $rows = $this->_db->fetchAll($this->_db->select('mid', 'name', 'slug', 'description')
            ->from('table.metas')->where('type = ?', 'category')
            ->order('mid', Db::SORT_ASC));

        $list = array();
        foreach ($rows as $row) {
            $mid = intval($row['mid']);
            $list[] = array(
                'mid'         => $mid,
                'name'        => strval($row['name']),
                'slug'        => strval($row['slug']),
                'description' => strval($row['description']),
                'count'       => count($this->_cidsOfCategory($mid)),
            );
        }
        $this->_json(array('code' => 0, 'data' => array('list' => $list)));
    }

    public function config()
    {
        $this->_guard(array($this, '_config'));
    }

    private function _config()
    {
        $this->_boot();
        $options = Options::alloc();

        $sliderOn = $this->_flag('featureSlider', true);
        $coverOn  = $this->_flag('featureCategoryCover', true);
        $archOn   = $this->_flag('featureArchive', true);
        $hitoOn   = $this->_flag('featureHitokoto', true);
        $rewardOn = $this->_flag('featureReward', true);
        $reward   = $rewardOn ? $this->_rewardImage() : '';
        $linksOn  = $this->_flag('featureLinks', true);
        $links    = $linksOn ? $this->_links() : array();
        // 头像先在本地找，缺的等响应发完再下载（首次请求不会卡在下载上）
        $this->_flushAvatars();

        $this->_json(array('code' => 0, 'data' => array(
            'title'       => strval($options->title),
            'description' => strval($options->description),
            'about'       => strval($this->_cfg->aboutText),
            'features'    => array(
                'slider'        => $sliderOn,
                'categoryCover' => $coverOn,
                'archive'       => $archOn,
                'hitokoto'      => $hitoOn,
                // 赞赏码没配图片时前端不显示按钮，避免点开空弹窗
                'reward'        => $reward !== '',
                'links'         => $linksOn && !empty($links),
            ),
            'slider'        => $sliderOn ? $this->_slider() : array(),
            'categoryCover' => $coverOn ? $this->_categoryCover() : '',
            'hitokotoImage' => $hitoOn ? $this->_hitokotoImage() : '',
            'rewardImage'   => $reward,
            'links'         => array('groups' => $links),
        )));
    }

    /** 赞赏码图片：支持网址/服务器绝对路径/相对路径，取不到返回空串 */
    private function _rewardImage()
    {
        $own = trim(strval($this->_cfg->rewardImage));
        if ($own === '') {
            return '';
        }
        $path = $this->_resolvePath($own, '');
        if ($path !== '' && @is_file($path)) {
            return $this->_pathToUrl($path);
        }
        // 外链或已可直接访问的地址
        return preg_match('#^(https?:)?//#i', $own) ? $this->_absUrl($own) : '';
    }

    /** 归档：封面 + 站点统计 + 按年月分组的文章 */
    public function archives()
    {
        $this->_guard(array($this, '_archives'));
    }

    private function _archives()
    {
        $this->_boot();

        if (!$this->_flag('featureArchive', true)) {
            $this->_json(array('code' => 0, 'data' => array(
                'cover' => '', 'stats' => null, 'groups' => array(), 'total' => 0,
            )));
            return;
        }

        $rows = $this->_db->fetchAll($this->_db->select('cid', 'title', 'slug', 'created')
            ->from('table.contents')
            ->where('type = ?', 'post')
            ->where('status = ?', 'publish')
            ->where('password IS NULL OR password = ?', '')
            ->order('created', Db::SORT_DESC)
            ->limit(2000));

        $groups = array();
        $index  = array();
        foreach ($rows as $r) {
            $ts  = intval($r['created']);
            $key = date('Y-m', $ts);
            if (!isset($index[$key])) {
                $index[$key] = count($groups);
                $groups[] = array(
                    'key'   => $key,
                    'label' => date('Y 年 n 月', $ts),
                    'count' => 0,
                    'posts' => array(),
                );
            }
            $groups[$index[$key]]['count']++;
            $groups[$index[$key]]['posts'][] = array(
                'cid'      => intval($r['cid']),
                'title'    => strval($r['title']),
                'dateText' => date('m-d', $ts),
            );
        }

        $this->_json(array('code' => 0, 'data' => array(
            'cover'  => $this->_archiveCover(),
            'stats'  => $this->_archiveStats(),
            'groups' => $groups,
            'total'  => count($rows),
        )));
    }

    /** 一言：关于页卡片用；默认读本站诗词文件，不发任何外部请求 */
    public function hitokoto()
    {
        $this->_guard(array($this, '_hitokoto'));
    }

    /**
     * 一言数据来源（自用兜底方案，默认不依赖第三方）：
     * 1) 设置里填了「外站」接口地址 → 服务端代理请求一次
     * 2) 本站诗词文件 yiyan.txt（默认链路；填本站地址时也自动走这里）
     * 3) 内置句子兜底，保证卡片永远有内容
     */
    private function _hitokoto()
    {
        $this->_boot();

        if (!$this->_flag('featureHitokoto', true)) {
            $this->_json(array('code' => 0, 'data' => array('enabled' => false)));
            return;
        }

        $api = trim(strval($this->_cfg->hitokotoApi));

        $text = '';
        $from = '';
        $fromWho = '';

        // 指向本站（含裸域/带 www）或留空时都不发 HTTP 请求，直接读本地文件
        $raw = '';
        if ($api !== '' && !$this->_isSelfUrl($api)) {
            $raw = $this->_fetchPage($api);
        }
        if (is_string($raw) && $raw !== '') {
            $j = json_decode($raw, true);
            if (is_array($j)) {
                foreach (array('hitokoto', 'text', 'content', 'sentence') as $k) {
                    if (isset($j[$k]) && trim(strval($j[$k])) !== '') {
                        $text = trim(strval($j[$k]));
                        break;
                    }
                }
                foreach (array('from', 'source', 'origin') as $k) {
                    if (isset($j[$k]) && trim(strval($j[$k])) !== '') {
                        $from = trim(strval($j[$k]));
                        break;
                    }
                }
                foreach (array('from_who', 'author', 'who') as $k) {
                    if (isset($j[$k]) && trim(strval($j[$k])) !== '') {
                        $fromWho = trim(strval($j[$k]));
                        break;
                    }
                }
            }
        }

        // 默认链路：读本地诗词 txt（yiyan.txt）
        if ($text === '') {
            $local = $this->_randomYiyanLine();
            if ($local !== null) {
                $text    = $local[0];
                $fromWho = $local[1];
                $from    = $local[2];
            } else {
                $text    = '人间有味是清欢。';
                $fromWho = '苏轼';
                $from    = '浣溪沙';
            }
        }

        $this->_json(array('code' => 0, 'data' => array(
            'enabled' => true,
            'text'    => $text,
            'from'    => $from,
            'fromWho' => $fromWho,
            'image'   => $this->_hitokotoImage(),
        )));
    }

    /* ---------------- 一言图库与本地诗词（主题目录 assets/yiyan） ---------------- */

    /** 站点根目录（统一正斜杠、无尾斜杠） */
    private function _rootDir()
    {
        return rtrim(str_replace('\\', '/', __TYPECHO_ROOT_DIR__), '/');
    }

    /** 地址是否指向本站（忽略协议、端口与 www 前缀差异） */
    private function _isSelfUrl($url)
    {
        $h1 = parse_url(trim(strval($url)), PHP_URL_HOST);
        $h2 = parse_url(trim(strval($this->_siteUrl)), PHP_URL_HOST);
        if (!$h1 || !$h2) {
            return false;
        }
        $norm = function ($host) {
            return preg_replace('/^www\./i', '', strtolower(strval($host)));
        };
        return $norm($h1) === $norm($h2);
    }

    /**
     * 把配置里的路径解析成服务器上的真实路径，兼容四种写法：
     * 1) 完整网址（https://站点域名/usr/themes/...）→ 取出路径部分再当站点内路径
     * 2) 服务器绝对路径（/wwwroot/usr/...）→ 原样用
     * 3) 站点内路径（/usr/themes/... 或 usr/themes/...）→ 拼到站点根目录
     * 4) 空 → 用默认相对路径
     * 外站网址无法在本地读取，返回空串。
     */
    private function _resolvePath($input, $defaultRelative)
    {
        $p = str_replace('\\', '/', trim(strval($input)));
        if ($p === '') {
            $p = $defaultRelative;
        }
        if ($p === '') {
            return '';
        }

        // 完整网址/协议相对写法：本站转本地路径，外站直接放弃
        if (preg_match('#^(https?:)?//#i', $p)) {
            if (!$this->_isSelfUrl($p)) {
                return '';
            }
            $urlPath  = strval(parse_url($p, PHP_URL_PATH));
            $selfPath = rtrim(strval(parse_url($this->_siteUrl, PHP_URL_PATH)), '/');
            if ($selfPath !== '' && strpos($urlPath, $selfPath) === 0) {
                $urlPath = substr($urlPath, strlen($selfPath));
            }
            $p = $urlPath === '' ? '/' : $urlPath;
        }

        $p    = rtrim($p, '/');
        if ($p === '') {
            $p = '/';
        }
        $root = $this->_rootDir();

        $isAbs = (strlen($p) > 1 && $p[1] === ':') || strpos($p, '/') === 0;
        if ($isAbs) {
            // 真实绝对路径（如 /wwwroot/usr/...）优先
            if (@file_exists($p)) {
                return $p;
            }
            // 填了 /usr/themes/... 这类“站点内路径”时，拼到站点根目录下
            return $root . '/' . ltrim($p, '/');
        }

        // 相对路径一律以站点根目录为基准（避免受 PHP 进程工作目录影响）
        $joined = $root . '/' . ltrim($p, '/');
        if (@file_exists($joined)) {
            return $joined;
        }
        return @file_exists($p) ? $p : $joined;
    }

    /** 一言资源目录：默认 站点根/usr/themes/HarmonyHues/assets/yiyan */
    private function _yiyanDir()
    {
        return $this->_resolvePath($this->_cfg->hitokotoDir, 'usr/themes/HarmonyHues/assets/yiyan');
    }

    /** 目录内的图片文件（webp/jpg/png/gif），按文件名排序 */
    private function _imagesInDir($dir)
    {
        $files = array();
        if ($dir === '' || !@is_dir($dir)) {
            return $files;
        }
        foreach (array('webp', 'jpg', 'jpeg', 'png', 'gif') as $ext) {
            $hit = @glob($dir . '/*.' . $ext);
            if (is_array($hit)) {
                foreach ($hit as $f) {
                    if (@is_file($f)) {
                        $files[] = $f;
                    }
                }
            }
        }
        sort($files);
        return array_values(array_unique($files));
    }

    /** 一言图库目录内的图片 */
    private function _yiyanImages()
    {
        return $this->_imagesInDir($this->_yiyanDir());
    }

    /** 随机取一张图，返回可直接访问的 URL（取不到返回空串） */
    private function _randomYiyanImage()
    {
        $files = $this->_yiyanImages();
        if (empty($files)) {
            return '';
        }
        return $this->_pathToUrl($files[array_rand($files)]);
    }

    /** 站点内绝对路径 → 可访问 URL */
    private function _pathToUrl($path)
    {
        $path = str_replace('\\', '/', $path);
        $root = $this->_rootDir();
        if (strpos($path, $root) === 0) {
            return rtrim($this->_siteUrl, '/') . substr($path, strlen($root));
        }
        return $path;
    }

    /**
     * 从本地诗词 txt 随机取一句。
     * 每行格式：句子——作者《出处》（作者可为空，如 ——《诗经》）
     * 返回 array(句子, 作者, 出处)；取不到返回 null
     */
    private function _randomYiyanLine()
    {
        $name = str_replace('\\', '/', trim(strval($this->_cfg->hitokotoTxt)));
        if ($name === '') {
            $name = 'yiyan.txt';
        }
        // 带目录/网址的按路径解析，否则取图库目录下的同名文件
        $isPath = (strlen($name) > 1 && $name[1] === ':') || strpos($name, '/') !== false;
        $path   = $isPath ? $this->_resolvePath($name, 'yiyan.txt')
                          : $this->_yiyanDir() . '/' . ltrim($name, '/');

        // 填错了也别让卡片没内容：回退到图库目录里的 yiyan.txt
        if ($path === '' || !@is_file($path)) {
            $dir = $this->_yiyanDir();
            if ($dir !== '' && @is_file($dir . '/yiyan.txt')) {
                $path = $dir . '/yiyan.txt';
            }
        }

        if (!@is_file($path) || !@is_readable($path)) {
            return null;
        }
        $raw = @file_get_contents($path);
        if (!is_string($raw) || $raw === '') {
            return null;
        }

        // 去 BOM；非 UTF-8（ANSI/GBK 保存的 txt）转码一次
        if (substr($raw, 0, 3) === "\xEF\xBB\xBF") {
            $raw = substr($raw, 3);
        }
        if (!preg_match('//u', $raw) && function_exists('mb_convert_encoding')) {
            $converted = @mb_convert_encoding($raw, 'UTF-8', 'GB18030');
            if (is_string($converted) && $converted !== '') {
                $raw = $converted;
            }
        }

        $lines = array();
        foreach (preg_split('/\r\n|\r|\n/', strval($raw)) as $line) {
            $line = trim(strval($line));
            if ($line !== '' && strpos($line, '——') !== false) {
                $lines[] = $line;
            }
        }
        if (empty($lines)) {
            return null;
        }

        $line = $lines[array_rand($lines)];
        $pos  = strpos($line, '——');
        $text = trim(substr($line, 0, $pos));
        $rest = trim(substr($line, $pos + strlen('——')));

        $from    = '';
        $fromWho = $rest;
        if (preg_match('/《([^》]*)》/u', $rest, $m)) {
            $from    = trim($m[1]);
            $fromWho = trim(str_replace($m[0], '', $rest));
        }
        $fromWho = trim($fromWho, " \t\n\r-—·");

        if ($text === '') {
            return null;
        }
        return array($text, $fromWho, $from);
    }

    /**
     * 一言卡片配图（全部走本地，不依赖外链）：
     * 1) 设置里填的是图片地址 → 直接用
     * 2) 设置里填的是目录（相对路径/绝对路径/完整网址都行）→ 在该目录里随机取一张
     * 3) 图库目录随机取一张
     * 4) 退到最新文章缩略图
     */
    private function _hitokotoImage()
    {
        $custom = trim(strval($this->_cfg->hitokotoImage));
        if ($custom !== '') {
            $path = $this->_resolvePath($custom, '');
            if ($path !== '' && @is_dir($path)) {
                // 目录：随机取一张
                $files = $this->_imagesInDir($path);
                if (!empty($files)) {
                    return $this->_pathToUrl($files[array_rand($files)]);
                }
            } elseif ($path !== '' && @is_file($path)) {
                // 本地图片文件
                return $this->_pathToUrl($path);
            } elseif (preg_match('#^(https?:)?//#i', $custom)) {
                // 外站图片地址，原样输出
                return $this->_absUrl($custom);
            }
        }

        $random = $this->_randomYiyanImage();
        if ($random !== '') {
            return $random;
        }

        $row = $this->_db->fetchRow($this->_db->select('cid', 'text')
            ->from('table.contents')
            ->where('type = ?', 'post')
            ->where('status = ?', 'publish')
            ->where('password IS NULL OR password = ?', '')
            ->order('created', Db::SORT_DESC)
            ->limit(1));
        if (!$row) {
            return '';
        }

        $thumb = $this->_fieldOf($row['cid'], 'thumb');
        if ($thumb !== '') {
            return $this->_absUrl($thumb);
        }
        return $this->_firstImage(strval($row['text']));
    }

    /* ---------------- 友情链接（解析网页端 /links.html） ---------------- */

    /**
     * 友情链接：抓网页端 links.html，只取「友邻列表」里的分组与卡片，
     * 页面上的「本站添加的友链要求」不解析。结果缓存 1 小时。
     */
    private function _links()
    {
        $cached = $this->_cacheGet('links', 3600);
        if ($cached !== null && isset($cached['groups']) && is_array($cached['groups'])) {
            return $cached['groups'];
        }

        // 上次抓取失败时只记 5 分钟，页面改好后不用等一小时
        if ($this->_cacheGet('links-empty', 300) !== null) {
            return array();
        }

        $html = $this->_fetchPage($this->_siteUrl . '/links.html');
        if (!is_string($html) || $html === '') {
            $this->_cacheSet('links-empty', array('t' => time()));
            return array();
        }

        $groups = $this->_linksFromHtml($html);
        if (empty($groups)) {
            $this->_cacheSet('links-empty', array('t' => time()));
            return array();
        }

        $this->_cacheSet('links', array('groups' => $groups));
        return $groups;
    }

    private function _linksFromHtml($html)
    {
        // 先去掉脚本与样式，避免 CSS 里的类名被当成结构匹配到
        $html   = preg_replace('#<(script|style)\b[^>]*>.*?</\1>#is', '', $html);
        $groups = array();

        if (!preg_match_all('#<section[^>]*class="[^"]*links-group[^"]*"[^>]*>(.*?)</section>#is', $html, $secs)) {
            return $groups;
        }

        foreach ($secs[1] as $sec) {
            $name = '';
            if (preg_match('#<h2[^>]*>(.*?)</h2>#is', $sec, $m)) {
                $name = $this->_plainText($m[1]);
            }

            $items = array();
            if (preg_match_all('#<a\b([^>]*)>(.*?)</a>#is', $sec, $rows, PREG_SET_ORDER)) {
                foreach ($rows as $row) {
                    $attrs = $row[1];
                    $inner = $row[2];

                    $url = '';
                    if (preg_match('#\bhref\s*=\s*"([^"]*)"#i', $attrs, $m)) {
                        $url = html_entity_decode(trim($m[1]), ENT_QUOTES, 'UTF-8');
                    }
                    if ($url === '' || !preg_match('#^https?://#i', $url)) {
                        continue;
                    }

                    $title = '';
                    if (preg_match('#class="[^"]*link-title[^"]*"[^>]*>(.*?)</div>#is', $inner, $m)) {
                        $title = $this->_plainText($m[1]);
                    }
                    if ($title === '' && preg_match('#\btitle\s*=\s*"([^"]*)"#i', $attrs, $m)) {
                        $title = html_entity_decode(trim($m[1]), ENT_QUOTES, 'UTF-8');
                    }
                    if ($title === '') {
                        continue;
                    }

                    $desc = '';
                    if (preg_match('#class="[^"]*link-desc[^"]*"[^>]*>(.*?)</div>#is', $inner, $m)) {
                        $desc = $this->_plainText($m[1]);
                    }

                    // 头像：优先懒加载的真实地址，退到 src
                    $avatar = '';
                    if (preg_match('#\bdata-original\s*=\s*"([^"]*)"#i', $inner, $m)) {
                        $avatar = $m[1];
                    } elseif (preg_match('#<img[^>]+src\s*=\s*"([^"]*)"#i', $inner, $m)) {
                        $avatar = $m[1];
                    }
                    $avatar = html_entity_decode(trim($avatar), ENT_QUOTES, 'UTF-8');

                    $items[] = array(
                        'name'   => $title,
                        'url'    => $url,
                        'desc'   => $desc,
                        'avatar' => $this->_avatarCached($avatar),
                    );
                }
            }

            if (!empty($items)) {
                $groups[] = array(
                    'name'  => $name === '' ? '友情链接' : $name,
                    'items' => $items,
                );
            }
        }

        return $groups;
    }

    /** 去标签、解实体、压缩空白 */
    private function _plainText($html)
    {
        $s = preg_replace('#<[^>]+>#', ' ', strval($html));
        $s = html_entity_decode($s, ENT_QUOTES, 'UTF-8');
        $s = preg_replace('/\s+/u', ' ', $s);
        return trim($s);
    }

    /**
     * 友链头像：只查本地缓存文件，不在这里下载。
     * 小程序 <image> 只加载白名单域名，外站头像直接引用必然裂图，
     * 所以由 _avatarDownload() 落地成本站文件；本次没命中时先返回空，前端用首字兜底。
     */
    private function _avatarCached($url)
    {
        $url = trim(strval($url));
        if ($url === '' || !preg_match('#^https?://#i', $url)) {
            return '';
        }
        if ($this->_isSelfUrl($url)) {
            return $this->_absUrl($url);
        }

        $dir = $this->_rootDir() . '/usr/uploads/miniapp-links';
        $hit = $this->_avatarFile($dir, $url);
        if ($hit !== '') {
            return $this->_pathToUrl($hit);
        }

        // 记下来，等响应发出去以后再下
        if (!in_array($url, $this->_pendingAvatars, true)) {
            $this->_pendingAvatars[] = $url;
        }
        return '';
    }

    /** 已缓存的头像文件路径（任意扩展名命中即返回），没有返回空串 */
    private function _avatarFile($dir, $url)
    {
        $key = md5($url);
        foreach (array('webp', 'jpg', 'png', 'gif') as $ext) {
            $f = $dir . '/' . $key . '.' . $ext;
            if (@is_file($f) && @filesize($f) > 0) {
                return $f;
            }
        }
        return '';
    }

    /** 真正下载一张头像并落地，返回文件路径；失败返回空串 */
    private function _avatarDownload($url)
    {
        $url = trim(strval($url));
        if ($url === '' || !preg_match('#^https?://#i', $url) || $this->_isSelfUrl($url)) {
            return '';
        }

        $dir = $this->_rootDir() . '/usr/uploads/miniapp-links';
        if (!@is_dir($dir) && !@mkdir($dir, 0755, true)) {
            return '';
        }
        if (!@is_writable($dir)) {
            return '';
        }

        $raw = $this->_fetchBinary($url);
        if (!is_string($raw) || strlen($raw) < 64) {
            return '';
        }
        $info = @getimagesizefromstring($raw);
        if (!$info || empty($info[2])) {
            return '';
        }

        $map = array(
            IMAGETYPE_JPEG => 'jpg',
            IMAGETYPE_PNG  => 'png',
            IMAGETYPE_GIF  => 'gif',
        );
        if (defined('IMAGETYPE_WEBP')) {
            $map[constant('IMAGETYPE_WEBP')] = 'webp';
        }
        $ext = isset($map[$info[2]]) ? $map[$info[2]] : '';
        if ($ext === '') {
            return '';
        }

        $file = $dir . '/' . md5($url) . '.' . $ext;
        if (@file_put_contents($file, $raw) === false) {
            return '';
        }
        return $file;
    }

    /**
     * 把待下载的头像放到响应发出之后再处理。
     * PHP-FPM 下 fastcgi_finish_request 先把 JSON 推给客户端，用户完全无感；
     * 非 FPM 环境只同步补一张，避免拖慢首屏。
     */
    private function _flushAvatars()
    {
        $pending = array_values(array_unique($this->_pendingAvatars));
        $this->_pendingAvatars = array();
        if (empty($pending)) {
            return;
        }

        $async = function_exists('fastcgi_finish_request');
        $pending = array_slice($pending, 0, $async ? 3 : 1);

        register_shutdown_function(function () use ($pending, $async) {
            if ($async) {
                @fastcgi_finish_request();
            }
            foreach ($pending as $u) {
                $this->_avatarDownload($u);
            }
        });
    }

    /** 抓二进制内容（图片用，超时更短） */
    private function _fetchBinary($url)
    {
        if (!function_exists('curl_init')) {
            return false;
        }
        $ch = curl_init($url);
        @curl_setopt_array($ch, array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 2,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT        => 3,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_USERAGENT      => 'MiniAppApi/' . self::PLUGIN_VERSION,
        ));
        $out  = @curl_exec($ch);
        $code = intval(@curl_getinfo($ch, CURLINFO_HTTP_CODE));
        @curl_close($ch);
        if (is_string($out) && $out !== '' && $code >= 200 && $code < 400) {
            return $out;
        }
        return false;
    }

    /** 诊断接口：查看摘要/封面抽取的中间结果，用于排查 */
    public function debug()
    {
        $this->_guard(array($this, '_debug'));
    }

    private function _debug()
    {
        $this->_boot();
        $cid = intval($this->_param('id', 0));
        if ($cid <= 0) {
            $row = $this->_db->fetchRow($this->_db->select('cid', 'text')
                ->from('table.contents')->where('type = ?', 'post')
                ->where('status = ?', 'publish')->order('created', Db::SORT_DESC)->limit(1));
        } else {
            $row = $this->_db->fetchRow($this->_db->select('cid', 'text')
                ->from('table.contents')->where('cid = ?', $cid)->limit(1));
        }
        if (!$row) {
            $this->_fail('没有可诊断的文章');
        }
        $raw = strval($row['text']);
        $this->_json(array('code' => 0, 'data' => array(
            'cid'         => intval($row['cid']),
            'rawLen'      => strlen($raw),
            'rawHead'     => substr($raw, 0, 120),
            'excerptLen'  => $this->_excerptLen(),
            'excerpt'     => $this->_makeExcerpt($raw, $this->_excerptLen()),
            'thumb'       => $this->_firstImage($raw),
            'mbstring'    => function_exists('mb_substr') ? 'yes' : 'no',
            'pcreError'   => preg_last_error(),
        )));
    }

    /* ---------------- 内部方法 ---------------- */

    /** 异常兜底：把错误以 JSON 返回，便于排查 */
    private function _guard(callable $fn)
    {
        try {
            $fn();
        } catch (\Throwable $e) {
            $this->_json(array('code' => 1, 'msg' => $e->getMessage(),
                'at' => basename($e->getFile()) . ':' . $e->getLine()));
        }
    }

    /**
     * CORS 放行
     *
     * 小程序在真机上是原生请求，不受同源限制；但 QQ/微信开发者工具的模拟器
     * 用 XHR 发起请求（且会带上 for-weapp-devtools 等自定义头，必然触发预检），
     * 服务端不返回 Access-Control-Allow-Origin 时会被浏览器直接拦掉，
     * 表现为「无法连接站点 / request:fail」。这里统一放行并直接应答 OPTIONS。
     *
     * 安全性：接口不使用 Cookie 鉴权（token 走 URL 参数），无需 Allow-Credentials，
     * 因此放开任意来源不会带来凭证泄露风险；文章密码保护仍由业务逻辑过滤。
     */
    private function _cors()
    {
        static $done = false;
        if ($done) {
            return;
        }
        $done = true;

        $allowHeaders = isset($_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS'])
            ? strval($_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS'])
            : 'Content-Type, X-Requested-With';

        @header('Access-Control-Allow-Origin: *');
        @header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        @header('Access-Control-Allow-Headers: ' . $allowHeaders);
        @header('Access-Control-Max-Age: 86400');
        @header('Vary: Origin, Access-Control-Request-Headers');

        if (isset($_SERVER['REQUEST_METHOD']) && strtoupper(strval($_SERVER['REQUEST_METHOD'])) === 'OPTIONS') {
            if (function_exists('http_response_code')) {
                http_response_code(204);
            }
            exit;
        }
    }

    private function _boot()
    {
        $this->_cors();
        $this->_db = Db::get();
        $options   = Options::alloc();
        $this->_cfg     = $options->plugin('MiniAppApi');
        $this->_siteUrl = strval($options->siteUrl);

        // 密钥校验（后台留空则跳过）
        $token = trim(strval($this->_cfg->token));
        if ($token !== '' && $token !== strval($this->_param('token', ''))) {
            $this->_fail('token 校验失败');
        }
    }

    private function _param($key, $default = null)
    {
        $v = isset($_GET[$key]) ? $_GET[$key] : $default;
        return is_string($v) ? strip_tags($v) : $v;
    }

    private function _excerptLen()
    {
        $len = intval($this->_cfg->excerptLen);
        return $len > 0 ? $len : 120;
    }

    /** 统一构造列表/计数查询 */
    private function _baseQuery($fields, $cids, $q)
    {
        $select = $this->_db->select($fields)
            ->from('table.contents')
            ->where('type = ?', 'post')
            ->where('status = ?', 'publish')
            ->where('password IS NULL OR password = ?', '');

        if (!empty($cids)) {
            $select->where('cid IN (' . implode(',', array_map('intval', $cids)) . ')');
        }
        if ($q !== '') {
            $select->where('title LIKE ?', '%' . $q . '%');
        }
        return $select;
    }

    private function _cidsOfCategory($mid)
    {
        $rows = $this->_db->fetchAll($this->_db->select('cid')
            ->from('table.relationships')->where('mid = ?', intval($mid)));
        $cids = array();
        foreach ($rows as $r) {
            $cids[] = intval($r['cid']);
        }
        return $cids;
    }

    /** 文章分类 / 标签 */
    private function _metasOf($cid, $type)
    {
        $rows = $this->_db->fetchAll(
            $this->_db->select('table.metas.mid', 'table.metas.name', 'table.metas.slug')
                ->from('table.metas')
                ->join('table.relationships', 'table.metas.mid = table.relationships.mid')
                ->where('table.relationships.cid = ?', intval($cid))
                ->where('table.metas.type = ?', $type)
        );
        $list = array();
        foreach ($rows as $r) {
            $list[] = array(
                'mid'  => intval($r['mid']),
                'name' => strval($r['name']),
                'slug' => strval($r['slug']),
            );
        }
        return $list;
    }

    private function _briefItem($row, $excerptLen, $thumb = '')
    {
        $text = isset($row['text']) ? strval($row['text']) : '';
        return array(
            'cid'         => intval($row['cid']),
            'title'       => strval($row['title']),
            'slug'        => strval($row['slug']),
            'created'     => intval($row['created']),
            'createdText' => date('Y-m-d', intval($row['created'])),
            'commentsNum' => intval($row['commentsNum']),
            'excerpt'     => $this->_makeExcerpt($text, $excerptLen),
            // 缩略图：后台填写的自定义字段 thumb 优先，其次取正文第一张图
            'thumb'       => $thumb !== '' ? $thumb : $this->_firstImage($text),
        );
    }

    /* ---------------- 自定义字段（thumb 等） ---------------- */

    /**
     * fields 表的字符串值列名
     *
     * Typecho 的 Mysql.sql / Pgsql.sql / SQLite.sql 中该列统一叫 str_value（text / TEXT），
     * 没有 value 这一列。极老版本或第三方改动过表结构时才可能不同，故下方仍做兜底重试。
     */
    private function _fieldValueCols()
    {
        return array('str_value', 'value');
    }

    /** 批量取自定义字段值：返回 cid => value 映射（取不到的不在映射里，出错不抛异常） */
    private function _fieldMapOf(array $cids, $name)
    {
        if (empty($cids)) {
            return array();
        }
        $in = implode(',', array_map('intval', $cids));
        $rows = array();
        $lastErr = null;
        foreach ($this->_fieldValueCols() as $col) {
            try {
                $rows = $this->_db->fetchAll($this->_db->select('cid', $col . ' AS v')
                    ->from('table.fields')
                    ->where('name = ?', strval($name))
                    ->where('cid IN (' . $in . ')'));
                $lastErr = null;
                break;
            } catch (\Throwable $e) {
                // 列名不匹配（如 1054 Unknown column）→ 换下一个候选列名重试
                $rows = array();
                $lastErr = $e;
            }
        }
        if ($lastErr !== null) {
            return array();
        }
        $map = array();
        foreach ($rows as $r) {
            $v = trim(strval($r['v']));
            if ($v !== '') {
                $map[intval($r['cid'])] = $v;
            }
        }
        return $map;
    }

    /** 单篇文章的自定义字段值 */
    private function _fieldOf($cid, $name)
    {
        $map = $this->_fieldMapOf(array(intval($cid)), $name);
        return isset($map[intval($cid)]) ? $map[intval($cid)] : '';
    }

    /** preg_replace 包装：出错时保留原值，避免 null 把结果链清空 */
    private function _rep($pattern, $replacement, $subject)
    {
        $r = @preg_replace($pattern, $replacement, $subject);
        return is_string($r) ? $r : $subject;
    }

    /** 生成纯文本摘要（剥离 Markdown / HTML） */
    private function _makeExcerpt($text, $len)
    {
        $len = max(10, intval($len));
        $raw = strval($text);
        if ($raw === '') {
            return '';
        }

        $t = $raw;

        // 1) 有 <!--more--> 就用分隔符前的部分
        $pos = stripos($t, '<!--more-->');
        if ($pos !== false && $pos > 0) {
            $t = substr($t, 0, $pos);
        }

        // 2) HTML 注释（含 Typecho 的 <!--markdown--> 标记）
        $t = $this->_rep('/<!--.*?-->/s', ' ', $t);
        // 3) 引用式链接定义行  [1]: http://...
        $t = $this->_rep('/^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$/m', ' ', $t);
        // 4) 代码块
        $t = $this->_rep('/```[\s\S]*?```/', ' ', $t);
        // 5) 图片：内联式与引用式
        $t = $this->_rep('/!\[[^\]]*\]\([^)]*\)/', ' ', $t);
        $t = $this->_rep('/!\[[^\]]*\]\[[^\]]*\]/', ' ', $t);
        // 6) 链接：内联式与引用式，保留文字
        $t = $this->_rep('/\[([^\]]*)\]\([^)]*\)/', '$1', $t);
        $t = $this->_rep('/\[([^\]]*)\]\[[^\]]*\]/', '$1', $t);
        // 7) 行内代码、标题井号、引用符号、分隔线、表格竖线
        $t = $this->_rep('/`([^`]*)`/', '$1', $t);
        $t = $this->_rep('/^[ \t]*#{1,6}[ \t]*/m', '', $t);
        $t = $this->_rep('/^[ \t]*>[ \t]?/m', '', $t);
        $t = $this->_rep('/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/m', ' ', $t);
        $t = $this->_rep('/[|*_~]+/', ' ', $t);
        // 8) HTML 标签
        $t = strip_tags($t);
        $t = html_entity_decode($t, ENT_QUOTES, 'UTF-8');
        // 9) 空白归一
        $t = $this->_rep('/\s+/u', ' ', $t);
        if ($t === '') {
            $t = $this->_rep('/\s+/', ' ', $t);
        }
        $t = trim($t);

        // 10) 兜底：仍为空则直接从原文去掉标签截断
        if ($t === '') {
            $t = trim(strip_tags($raw));
            $t = $this->_rep('/\s+/u', ' ', $t);
        }

        if ($t === '') {
            return '';
        }
        if (function_exists('mb_substr')) {
            return mb_substr($t, 0, $len, 'UTF-8');
        }
        return substr($t, 0, $len);
    }

    /** 抽取第一张图片作为封面，兼容内联式、引用式与 <img> */
    private function _firstImage($text)
    {
        $t = strval($text);
        if ($t === '') {
            return '';
        }

        // 内联式 ![alt](url) / ![alt](url "title")
        if (preg_match('/!\[[^\]]*\]\(\s*([^)\s]+)/', $t, $m)) {
            return $this->_absUrl($m[1]);
        }

        // 引用式 ![alt][1] + [1]: url
        if (preg_match_all('/^[ \t]*\[([^\]]+)\]:[ \t]*(\S+)/m', $t, $defs, PREG_SET_ORDER)) {
            $map = array();
            foreach ($defs as $d) {
                $map[strtolower(trim($d[1]))] = $d[2];
            }
            if (preg_match_all('/!\[[^\]]*\]\[([^\]]*)\]/', $t, $refs, PREG_SET_ORDER)) {
                foreach ($refs as $r) {
                    $key = strtolower(trim($r[1]));
                    if ($key !== '' && isset($map[$key])) {
                        return $this->_absUrl($map[$key]);
                    }
                }
            }
        }

        // HTML <img src>
        if (preg_match('/<img[^>]+src=["\']([^"\']+)/i', $t, $m)) {
            return $this->_absUrl($m[1]);
        }

        return '';
    }

    /** 相对图片地址补全为绝对地址 */
    private function _absUrl($url)
    {
        $url = trim(strval($url));
        if ($url === '') {
            return '';
        }
        $out = $url;
        if (preg_match('#^https?://#i', $url)) {
            $out = $url;
        } elseif (strpos($url, '//') === 0) {
            $scheme = stripos($this->_siteUrl, 'https://') === 0 ? 'https:' : 'http:';
            $out    = $scheme . $url;
        } elseif (strpos($url, '/') === 0) {
            $p = parse_url($this->_siteUrl);
            if (!empty($p['host'])) {
                $base = $p['scheme'] . '://' . $p['host'];
                if (!empty($p['port'])) {
                    $base .= ':' . $p['port'];
                }
                $out = $base . $url;
            }
        }
        return $this->_normSelfHost($out);
    }

    /**
     * 把本站资源的域名统一成站点设置里的域名。
     * 网页端 HTML 里常出现裸域（xiehongwei.cn）与带 www 混用，
     * 小程序 downloadFile 白名单只认一个域名，混用会直接加载失败。
     */
    private function _normSelfHost($url)
    {
        if (!preg_match('#^https?://#i', strval($url))) {
            return $url;
        }
        $selfHost = parse_url($this->_siteUrl, PHP_URL_HOST);
        $urlHost  = parse_url($url, PHP_URL_HOST);
        if (!$selfHost || !$urlHost || strcasecmp($selfHost, $urlHost) === 0) {
            return $url;
        }
        // 站点部署在子目录时不做替换，避免路径被拼重复
        $selfPath = strval(parse_url($this->_siteUrl, PHP_URL_PATH));
        if ($selfPath !== '' && $selfPath !== '/') {
            return $url;
        }
        if (!$this->_isSelfUrl($url)) {
            return $url;
        }
        $p = parse_url($url);
        return rtrim($this->_siteUrl, '/')
            . (isset($p['path']) ? $p['path'] : '')
            . (isset($p['query']) ? '?' . $p['query'] : '');
    }

    /* ---------------- 功能开关与网页端内容引用 ---------------- */

    /**
     * 读取开关型配置。老版本配置里没有该键时返回 $default，
     * 保证插件升级后默认行为符合预期（三个功能默认开启）。
     */
    private function _flag($key, $default)
    {
        $v = $this->_cfg->{$key};
        if ($v === null || $v === '') {
            return $default;
        }
        return strval($v) === '1';
    }

    /** 抓取站点自身页面（curl 优先，回退 file_get_contents） */
    private function _fetchPage($url)
    {
        if ($url === '') {
            return false;
        }

        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            @curl_setopt_array($ch, array(
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS      => 3,
                CURLOPT_CONNECTTIMEOUT => 3,
                CURLOPT_TIMEOUT        => 5,
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_SSL_VERIFYHOST => 0,
                CURLOPT_ENCODING       => '',
                CURLOPT_USERAGENT      => 'MiniAppApi/' . self::PLUGIN_VERSION,
            ));
            $out  = @curl_exec($ch);
            $code = intval(@curl_getinfo($ch, CURLINFO_HTTP_CODE));
            @curl_close($ch);
            if (is_string($out) && $out !== '' && $code >= 200 && $code < 400) {
                return $out;
            }
            return false;
        }

        $ctx = @stream_context_create(array('http' => array(
            'timeout'    => 5,
            'user_agent' => 'MiniAppApi/' . self::PLUGIN_VERSION,
        )));
        $out = @file_get_contents($url, false, $ctx);
        return is_string($out) && $out !== '' ? $out : false;
    }

    private function _cachePath($key)
    {
        return rtrim(sys_get_temp_dir(), '/\\') . '/miniapp-' . md5($this->_siteUrl . '|' . $key) . '.json';
    }

    private function _cacheGet($key, $ttl)
    {
        $path = $this->_cachePath($key);
        if (!is_file($path)) {
            return null;
        }
        $age = time() - intval(@filemtime($path));
        if ($age < 0 || $age > $ttl) {
            return null;
        }
        $raw = @file_get_contents($path);
        if (!is_string($raw) || $raw === '') {
            return null;
        }
        $val = json_decode($raw, true);
        return is_array($val) ? $val : null;
    }

    private function _cacheSet($key, $val)
    {
        @file_put_contents($this->_cachePath($key), json_encode($val, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    /** 首页轮播：设置里填了 JSON 就用它，否则引用网页端首页轮播（缓存 1 小时） */
    private function _slider()
    {
        $json = trim(strval($this->_cfg->sliderJson));

        if ($json !== '') {
            $arr = json_decode($json, true);
            if (is_array($arr)) {
                $manual = array();
                foreach ($arr as $it) {
                    if (!is_array($it)) {
                        continue;
                    }
                    $img = $this->_absUrl(isset($it['image']) ? $it['image'] : '');
                    if ($img === '') {
                        continue;
                    }
                    $manual[] = array(
                        'image' => $img,
                        'label' => isset($it['label']) ? strval($it['label']) : '',
                        'title' => isset($it['title']) ? strval($it['title']) : '',
                        'desc'  => isset($it['desc']) ? strval($it['desc']) : '',
                        'link'  => $this->_absUrl(isset($it['link']) ? $it['link'] : ''),
                    );
                }
                if (!empty($manual)) {
                    return $manual;
                }
            }
        }

        $cached = $this->_cacheGet('slider', 3600);
        if ($cached !== null) {
            return $cached;
        }

        $html   = $this->_fetchPage($this->_siteUrl . '/');
        $slides = $html === false ? array() : $this->_parseSlides($html);
        // 抓取失败不写缓存，下次请求立即重试
        if ($html !== false) {
            $this->_cacheSet('slider', $slides);
        }
        return $slides;
    }

    /** 解析 HarmonyHues 首页 swiper-slide 结构 */
    private function _parseSlides($html)
    {
        $slides = array();
        if (!preg_match_all('#<div class="swiper-slide">(.*?)</a></div>#s', $html, $m)) {
            return $slides;
        }
        foreach ($m[1] as $block) {
            $img = '';
            if (preg_match('#(?:data-src|data-original)="([^"]+)"#', $block, $t)) {
                $img = $t[1];
            } elseif (preg_match('#<img[^>]+src="([^"]+)"#i', $block, $t)) {
                $img = $t[1];
            }
            $img = $this->_absUrl($img);
            if ($img === '') {
                continue;
            }
            $link = '';
            if (preg_match('#<a[^>]+href="([^"]+)"#i', $block, $t)) {
                $link = $t[1];
            }
            $slides[] = array(
                'image' => $img,
                'label' => $this->_pickText($block, 'swiper-slide-label'),
                'title' => $this->_pickText($block, 'swiper-slide-title'),
                'desc'  => $this->_pickText($block, 'swiper-slide-description'),
                'link'  => $link === '' ? '' : $this->_absUrl($link),
            );
        }
        return $slides;
    }

    /** 从 HTML 片段里取指定 class 的首个文本 */
    private function _pickText($block, $class)
    {
        $pattern = '#class="[^"]*' . preg_quote($class, '#') . '[^"]*"[^>]*>(.*?)</#s';
        if (preg_match($pattern, $block, $t)) {
            return trim(html_entity_decode(strip_tags($t[1]), ENT_QUOTES, 'UTF-8'));
        }
        return '';
    }

    /** 从整页 HTML 里取 .category-box 内的封面图 */
    private function _coverFromHtml($html)
    {
        // 内联样式/脚本里也会出现 category-box（如 .files-hero .category-box），先剔除避免误命中
        $body = preg_replace('#<style\b[^>]*>.*?</style>#is', '', $html);
        $body = preg_replace('#<script\b[^>]*>.*?</script>#is', '', $body);
        if (!is_string($body)) {
            $body = $html;
        }

        $pos = strpos($body, 'category-box');
        if ($pos === false) {
            return '';
        }
        $chunk = substr($body, $pos, 900);
        if (preg_match('#(?:data-original|data-src)="([^"]+)"#', $chunk, $t)) {
            return $this->_absUrl($t[1]);
        }
        if (preg_match('#<img[^>]+src="([^"]+)"#i', $chunk, $t)) {
            return $this->_absUrl($t[1]);
        }
        return '';
    }

    /** 分类页封面：设置优先，否则取第一个分类页的封面图（缓存 1 天） */
    private function _categoryCover()
    {
        $own = trim(strval($this->_cfg->categoryCover));
        if ($own !== '') {
            return $this->_absUrl($own);
        }

        $cached = $this->_cacheGet('category-cover', 86400);
        if ($cached !== null && isset($cached['url'])) {
            return $this->_absUrl($cached['url']);
        }

        $row = $this->_db->fetchRow($this->_db->select('slug')
            ->from('table.metas')
            ->where('type = ?', 'category')
            ->order('mid', Db::SORT_ASC)
            ->limit(1));

        $url = '';
        if ($row) {
            $html = $this->_fetchPage($this->_siteUrl . '/category/' . rawurlencode(strval($row['slug'])) . '/');
            if ($html !== false) {
                $url = $this->_coverFromHtml($html);
                $this->_cacheSet('category-cover', array('url' => $url));
            }
        }
        return $url;
    }

    /** 归档页封面：设置优先，否则取归档页封面图（缓存 1 天） */
    private function _archiveCover()
    {
        $own = trim(strval($this->_cfg->archiveCover));
        if ($own !== '') {
            return $this->_absUrl($own);
        }

        $cached = $this->_cacheGet('archive-cover', 86400);
        if ($cached !== null && isset($cached['url'])) {
            return $this->_absUrl($cached['url']);
        }

        $html = $this->_fetchPage($this->_siteUrl . '/archives.html');
        if ($html === false) {
            return '';
        }
        $url = $this->_coverFromHtml($html);
        $this->_cacheSet('archive-cover', array('url' => $url));
        return $url;
    }

    /** 归档统计：文章 / 分类 / 页面 / 评论 / 标签 / 建站天数 */
    private function _archiveStats()
    {
        $row = $this->_db->fetchRow($this->_db->select('created')
            ->from('table.contents')
            ->where('status = ?', 'publish')
            ->order('created', Db::SORT_ASC)
            ->limit(1));
        $days = $row ? intval(floor((time() - intval($row['created'])) / 86400)) : 0;

        return array(
            'posts'      => $this->_countRows('table.contents', array('type' => 'post', 'status' => 'publish')),
            'categories' => $this->_countRows('table.metas', array('type' => 'category')),
            'pages'      => $this->_countRows('table.contents', array('type' => 'page', 'status' => 'publish')),
            'comments'   => $this->_countRows('table.comments', array()),
            'tags'       => $this->_countRows('table.metas', array('type' => 'tag')),
            'days'       => max(0, $days),
        );
    }

    private function _countRows($table, array $conds)
    {
        $select = $this->_db->select('COUNT(*) AS num')->from($table);
        foreach ($conds as $field => $value) {
            $select->where($field . ' = ?', $value);
        }
        $row = $this->_db->fetchRow($select);
        return $row ? intval($row['num']) : 0;
    }

    private function _json($data)
    {
        $this->_cors();
        @header('Content-Type: application/json; charset=UTF-8');
        exit(json_encode($data, JSON_UNESCAPED_UNICODE));
    }

    private function _fail($msg)
    {
        $this->_json(array('code' => 1, 'msg' => $msg));
    }
}
