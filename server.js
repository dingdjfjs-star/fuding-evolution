/* 《福鼎城镇演化》零依赖静态服务器：node server.js [端口] */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');

var root = __dirname;
var port = parseInt(process.argv[2], 10) || 8943;
var MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

http.createServer(function (req, res) {
  var urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  var file = path.normalize(path.join(root, urlPath));
  if (file.indexOf(root) !== 0) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}).listen(port, function () {
  console.log('《福鼎城镇演化》已启动:  http://127.0.0.1:' + port);
});
