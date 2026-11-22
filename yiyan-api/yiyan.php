<?php
/**
 * 一言 JSON 接口（单文件，无需插件/数据库）
 *
 * 放到网站根目录，例如 /wwwroot/yiyan.php，访问：
 *   https://www.xiehongwei.cn/yiyan.php            → JSON
 *   https://www.xiehongwei.cn/yiyan.php?format=text → 纯文本一句
 *   https://www.xiehongwei.cn/yiyan.php?img=0       → 不要配图
 *
 * 数据来源同目录约定：usr/themes/HarmonyHues/assets/yiyan/
 *   - 任意 webp/jpg/jpeg/png/gif：随机选一张作为配图
 *   - yiyan.txt：每行「句子——作者《出处》」（作者可为空），随机取一句
 * 若目录放别处，只改下面 $DIR 一行。
 */

// ============ 可改配置 ============
$DIR       = __DIR__ . '/usr/themes/HarmonyHues/assets/yiyan'; // 图库与诗词 txt 所在目录
$TXT_NAME  = 'yiyan.txt';
$ALLOW_GZIP = true;
// =================================

// 兼容放在子目录 / 目录被改名的情况：找不到就往上找两级
$candidates = array(
    $DIR,
    __DIR__ . '/../usr/themes/HarmonyHues/assets/yiyan',
    dirname(__DIR__) . '/usr/themes/HarmonyHues/assets/yiyan',
);
foreach ($candidates as $c) {
    if (@is_dir($c)) {
        $DIR = $c;
        break;
    }
}

/* ---------------- 工具 ---------------- */

function jout($data, $status = 200)
{
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: GET, OPTIONS');
        header('Cache-Control: no-store, no-cache, must-revalidate');
    }
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function read_lines($file)
{
    if (!@is_file($file) || !@is_readable($file)) {
        return array();
    }
    $raw = @file_get_contents($file);
    if (!is_string($raw) || $raw === '') {
        return array();
    }
    // 去 BOM
    if (substr($raw, 0, 3) === "\xEF\xBB\xBF") {
        $raw = substr($raw, 3);
    }
    // 非 UTF-8（ANSI/GBK 保存的 txt）转码
    if (!preg_match('//u', $raw) && function_exists('mb_convert_encoding')) {
        $tmp = @mb_convert_encoding($raw, 'UTF-8', 'GB18030');
        if (is_string($tmp) && $tmp !== '') {
            $raw = $tmp;
        }
    }
    $out = array();
    foreach (preg_split('/\r\n|\r|\n/', $raw) as $line) {
        $line = trim($line);
        if ($line !== '') {
            $out[] = $line;
        }
    }
    return $out;
}

/** 拆「句子——作者《出处》」 */
function parse_line($line)
{
    $text = $line;
    $from = '';
    $who  = '';

    $pos = strpos($line, '——');
    if ($pos === false) {
        $pos = strpos($line, ' - ');
    }
    if ($pos !== false) {
        $sep  = substr($line, $pos, 3) === '——' ? '——' : ' - ';
        $text = trim(substr($line, 0, $pos));
        $rest = trim(substr($line, $pos + strlen($sep)));

        if (preg_match('/《([^》]*)》/u', $rest, $m)) {
            $from = trim($m[1]);
            $who  = trim(str_replace($m[0], '', $rest));
        } else {
            $who = $rest;
        }
        $who = trim($who, " \t\n\r-—·");
    }

    return array($text !== '' ? $text : $line, $who, $from);
}

/** 目录内的图片 */
function list_images($dir)
{
    $files = array();
    if (!@is_dir($dir)) {
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

/** 本地文件 → 可访问 URL（自动用当前请求的域名） */
function file_url($path, $dir)
{
    $scheme = 'http';
    if ((isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== '' && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https')) {
        $scheme = 'https';
    }
    $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'localhost';
    $docroot = isset($_SERVER['DOCUMENT_ROOT']) ? rtrim(str_replace('\\', '/', $_SERVER['DOCUMENT_ROOT']), '/') : '';

    $abs = str_replace('\\', '/', $path);
    $rel = '';
    if ($docroot !== '' && strpos($abs, $docroot) === 0) {
        $rel = substr($abs, strlen($docroot));
    } else {
        // DOCUMENT_ROOT 不匹配时（部分面板），按图库目录反推 web 路径
        $rel = '/usr/themes/HarmonyHues/assets/yiyan/' . basename($abs);
    }
    return $scheme . '://' . $host . $rel;
}

/* ---------------- 输出 ---------------- */

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    exit;
}

$format  = isset($_GET['format']) ? strtolower(trim($_GET['format'])) : 'json';
$withImg = !(isset($_GET['img']) && $_GET['img'] === '0');

$lines = read_lines($DIR . '/' . $TXT_NAME);
$images = list_images($DIR);

if (empty($lines)) {
    jout(array('code' => 500, 'msg' => '未找到诗词文件或文件为空：' . $TXT_NAME), 500);
}

$line = $lines[array_rand($lines)];
list($text, $who, $from) = parse_line($line);

$imageUrl  = '';
$imageFile = '';
if ($withImg && !empty($images)) {
    $pick = $images[array_rand($images)];
    $imageUrl  = file_url($pick, $DIR);
    $imageFile = basename($pick);
}

// 纯文本模式：直接输出一句话
if ($format === 'text' || $format === 'txt') {
    if (!headers_sent()) {
        header('Content-Type: text/plain; charset=utf-8');
        header('Access-Control-Allow-Origin: *');
        header('Cache-Control: no-store');
    }
    echo $text;
    if ($who !== '' || $from !== '') {
        echo '——' . $who . ($from !== '' ? '《' . $from . '》' : '');
    }
    exit;
}

// JSON 模式：同时给 hitokoto 原生字段（可直接替换 v1.hitokoto.cn）和本项目字段
jout(array(
    'code'       => 0,

    // hitokoto 兼容字段
    'hitokoto'   => $text,
    'from'       => $from,
    'from_who'   => $who,
    'type'       => 'a',
    'uuid'       => bin2hex(random_bytes(8)),

    // 小程序 / 本项目字段
    'text'       => $text,
    'fromWho'    => $who,

    // 配图
    'image'      => $imageUrl,
    'imageFile'  => $imageFile,

    // 资源统计（方便排查）
    'total'      => count($lines),
    'images'     => count($images),
    'time'       => date('Y-m-d H:i:s'),
));
