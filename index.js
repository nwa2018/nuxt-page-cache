const LRU = require('lru-cache')
const queues = Object.create(null)

const defaults = {
  max: 64 * 1000000,
  length: function (n, key) {
    if (n.body && typeof n.body === 'string') {
      return n.body.length
    }
    return 1
  },
  maxAge: 200
}

let cacheStore = new LRU(defaults)

module.exports.config = function (opts) {
  if (opts && opts.max) {
    defaults.max = opts.max
  }
  cacheStore = new LRU(defaults)
  return this
}

function drainQueue (key) {
  let subscriber = null
  while (queues[key] && queues[key].length > 0) {
    subscriber = queues[key].shift()
    process.nextTick(subscriber)
  }
  delete queues[key]
}

module.exports.cacheSeconds = function (secondsTTL, cacheKey) {
  const ttl = secondsTTL * 1000
  return function (req, res, next) {
    let key = req.originalUrl
    if (typeof cacheKey === 'function') {
      key = cacheKey(req, res)
      if (!key) { return next() }
    } else if (typeof cacheKey === 'string') {
      key = cacheKey
    }

    const value = cacheStore.get(key)
    if (value) {
      return res.end(value.body)
    }

    res.original_end = res.end

    if (!queues[key]) {
      queues[key] = []
    }

    let didHandle = false

    function rawEnd (data) {
      didHandle = true
      if (res.statusCode === 200) {
        if (data.length < 10) {
          console.log('返回数据长度<10，出bug了吧？')
        } else {
          cacheStore.set(key, { body: data}, ttl)
        }
      }

      // send this response to everyone in the queue
      drainQueue(key)

      res.original_end(data)
    }

    // first request will get rendered output
    if (queues[key].length === 0) {
      didHandle = false
      res.end = function (data) {
        rawEnd(data)
      }
      next()
    } else {
      queues[key].push(function () {
        const value = cacheStore.get(key) || {}
        res.end(value.body)
      })
    }
  }
}

module.exports.removeCache = function (url) {
  cacheStore.del(url)
}

module.exports.cacheStore = cacheStore
