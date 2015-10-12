/**
 * 打包插件。用法：
 *
 * fis.match('*.js', {
 *   packTo: 'pkg/all.js'
 * });
 *
 *
 * 或者：
 *
 * fis.set('pack', {
 *   '/pkg/all.js': '*.js'
 * });
 */
var path = require('path');
var _ = fis.util;

module.exports = function(ret, pack, settings, opt) {
  var fromSettings = false;

  if (settings && Object.keys(settings).length) {
    fromSettings = true;
    pack = settings;
  }

  var src = ret.src;
  var sources = [];
  var packed = {}; // cache all packed resource.
  var ns = fis.config.get('namespace');
  var connector = fis.config.get('namespaceConnector', ':');
  var root = fis.project.getProjectPath();

  // 生成数组
  Object.keys(src).forEach(function(key) {
    sources.push(src[key]);
  });

  function find(reg, rExt) {
    if (src[reg]) {
      return [src[reg]];
    } else if (reg === '**') {
      // do nothing
    } else if (typeof reg === 'string') {
      reg = _.glob(reg);
    }

    return sources.filter(function(file) {
      reg.lastIndex = 0;
      return (reg === '**' || reg.test(file.subpath)) && (!rExt || file.rExt === rExt);
    });
  }

  Object.keys(pack).forEach(function(subpath, index) {
    var patterns = pack[subpath];

    if (!Array.isArray(patterns)) {
      patterns = [patterns];
    }

    var pid = (ns ? ns + connector : '') + 'p' + index;
    var pkg = fis.file.wrap(path.join(root, subpath));

    if (typeof ret.src[pkg.subpath] !== 'undefined') {
      fis.log.warning('there is a namesake file of package [' + subpath + ']');
    }

    var list = [];

    patterns.forEach(function(pattern, index) {
      var exclude = typeof pattern === 'string' && pattern.substring(0, 1) === '!';

      if (exclude) {
        pattern = pattern.substring(1);

        // 如果第一个规则就是排除用法，都没有获取结果就排除，这是不合理的用法。
        // 不过为了保证程序的正确性，在排除之前，通过 `**` 先把所有文件获取到。
        // 至于性能问题，请用户使用时规避。
        index === 0 && (list = find('**'));
      }

      var mathes = find(pattern, pkg.rExt);
      list = _[exclude ? 'difference' : 'union'](list, mathes);
    });

    // 根据 packOrder 排序
    /*
    fromSettings || (list = list.sort(function(a, b) {
      var a1 = a.packOrder >> 0;
      var b1 = b.packOrder >> 0;

      if (a1 === b1) {
        //此处排序有问题，如果packOrder相等，为什么是按照索引进行排序？
        //排序过程中不是对象的索引位置是会变的！
        return 0;
        //return list.indexOf(a) - list.indexOf(b);
      }

      return a1 - b1;
    }));
    */
    //Array 的sort方法当数组元素多于10个的时候，会有问题在nodejs 4.1.1中有bug
    //新版本的chrome中也是有这样的问题，但是其他版本的nodejs有没有问题，没有测试过
    //[1,2,3,4,5,6,7,8,9,10,11].sort(function(a,b){return 0})
    //chrome中输出：[6, 1, 3, 4, 5, 2, 7, 8, 9, 10, 11]
    fromSettings || (list = _.sortBy(list, function (a) {
      return a.packOrder;
    }));

    // sort by dependency
    var filtered = [];
    while (list.length) {
      add(list.shift());
    }

    function add(file) {
      if (file.requires) {
        file.requires.forEach(function(id) {
          var dep = ret.ids[id];
          var idx;
          if(dep && dep.rExt === pkg.rExt && ~(idx = list.indexOf(dep))){
            add(list.splice(idx, 1)[0]);
          }
        })
      }

      if (!packed[file.subpath] && file.rExt === pkg.rExt) {
        packed[file.subpath] = true;
        filtered.push(file);
      }
    }

    var content = '';
    var has = [];
    var requires = [];
    var requireMap = {};

    filtered.forEach(function(file) {
      var id = file.getId();

      if (ret.map.res[id]) {
        var c = file.getContent();

        // 派送事件
        var message = {
          file: file,
          content: c,
          pkg: pkg
        };
        fis.emit('pack:file', message);
        c = message.content;

        if (c) {
          content += content ? '\n' : '';

          if (file.isJsLike) {
            content += ';';
          } else if (file.isCssLike) {
            c = c.replace(/@charset\s+(?:'[^']*'|"[^"]*"|\S*);?/gi, '');
          }

          content += '/*!' + file.subpath + '*/\n' + c;
        }

        ret.map.res[id].pkg = pid;
        requires = requires.concat(file.requires);
        requireMap[id] = true;
        has.push(id);
      }
    });

    if (has.length) {
      pkg.setContent(content);
      ret.pkg[pkg.subpath] = pkg;

      // collect dependencies
      var deps = [];
      requires.forEach(function(id) {
        if (!requireMap[id]) {
          deps.push(id);
          requireMap[id] = true;
        }
      });
      var pkgInfo = ret.map.pkg[pid] = {
        uri: pkg.getUrl(opt.hash, opt.domain),
        type: pkg.rExt.replace(/^\./, ''),
        has: has
      };
      if (deps.length) {
        pkgInfo.deps = deps;
      }
    }
  });
};
