'use strict';

var rangeParser = require('range-parser'),
  pump = require('pump'),
  _ = require('lodash'),
  express = require('express'),
  logger = require('morgan'),
  bodyParser = require('body-parser'),
  multipart = require('connect-multiparty'),
  fs = require('fs'),
  path = require('path'),
  archiver = require('archiver'),
  store = require('./store'),
  progress = require('./progressbar'),
  stats = require('./stats'),
  api = express();

// Movies JSON file path
var moviesFilePath = path.join(__dirname, '..', 'movies.json');

// Helper functions for movies management
function loadMovies() {
  try {
    if (fs.existsSync(moviesFilePath)) {
      var data = fs.readFileSync(moviesFilePath, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (err) {
    console.error('Error loading movies:', err);
    return [];
  }
}

function saveMovies(movies) {
  try {
    fs.writeFileSync(moviesFilePath, JSON.stringify(movies, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving movies:', err);
    throw err;
  }
}

function findMovieById(id) {
  var movies = loadMovies();
  return movies.find(function(movie) {
    return movie.id === id;
  });
}

api.use(bodyParser.json())
api.use(logger('dev'));
api.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'OPTIONS, POST, GET, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

function serialize(torrent) {
  if (!torrent.torrent) {
    return { infoHash: torrent.infoHash };
  }
  var pieceLength = torrent.torrent.pieceLength;

  return {
    infoHash: torrent.infoHash,
    name: torrent.torrent.name,
    length: torrent.torrent.length,
    interested: torrent.amInterested,
    ready: torrent.ready,
    files: torrent.files.map(function (f) {
      // jshint -W016
      var start = f.offset / pieceLength | 0;
      var end = (f.offset + f.length - 1) / pieceLength | 0;

      return {
        name: f.name,
        path: f.path,
        link: '/torrents/' + torrent.infoHash + '/files/' + encodeURIComponent(f.path),
        length: f.length,
        offset: f.offset,
        selected: torrent.selection.some(function (s) {
          return s.from <= start && s.to >= end;
        })
      };
    }),
    progress: progress(torrent.bitfield.buffer)
  };
}

function findTorrent(req, res, next) {
  var torrent = req.torrent = store.get(req.params.infoHash);
  if (!torrent) {
    return res.sendStatus(404);
  }
  next();
}

api.get('/torrents', function (req, res) {
  res.send(store.list().map(serialize));
});

api.post('/torrents', function (req, res) {
  store.add(req.body.link, function (err, infoHash) {
    if (err) {
      console.error(err);
      res.status(500).send(err);
    } else {
      res.send({ infoHash: infoHash });
    }
  });
});

api.post('/upload', multipart(), function (req, res) {
  var file = req.files && req.files.file;
  if (!file) {
    return res.status(500).send('file is missing');
  }
  store.add(file.path, function (err, infoHash) {
    if (err) {
      console.error(err);
      res.status(500).send(err);
    } else {
      res.send({ infoHash: infoHash });
    }
    fs.unlink(file.path, function (err) {
      if (err) {
        console.error(err);
      }
    });
  });
});

api.get('/torrents/:infoHash', findTorrent, function (req, res) {
  res.send(serialize(req.torrent));
});

api.post('/torrents/:infoHash/start/:index?', findTorrent, function (req, res) {
  var index = parseInt(req.params.index);
  if (index >= 0 && index < req.torrent.files.length) {
    req.torrent.files[index].select();
  } else {
    req.torrent.files.forEach(function (f) {
      f.select();
    });
  }
  res.sendStatus(200);
});

api.post('/torrents/:infoHash/stop/:index?', findTorrent, function (req, res) {
  var index = parseInt(req.params.index);
  if (index >= 0 && index < req.torrent.files.length) {
    req.torrent.files[index].deselect();
  } else {
    req.torrent.files.forEach(function (f) {
      f.deselect();
    });
  }
  res.sendStatus(200);
});

api.post('/torrents/:infoHash/pause', findTorrent, function (req, res) {
  req.torrent.swarm.pause();
  res.sendStatus(200);
});

api.post('/torrents/:infoHash/resume', findTorrent, function (req, res) {
  req.torrent.swarm.resume();
  res.sendStatus(200);
});

api.delete('/torrents/:infoHash', findTorrent, function (req, res) {
  store.remove(req.torrent.infoHash);
  res.sendStatus(200);
});

api.get('/torrents/:infoHash/stats', findTorrent, function (req, res) {
  res.send(stats(req.torrent));
});

api.get('/torrents/:infoHash/files', findTorrent, function (req, res) {
  var torrent = req.torrent;
  var proto = req.get('x-forwarded-proto') || req.protocol;
  var host = req.get('x-forwarded-host') || req.get('host');
  res.setHeader('Content-Type', 'application/x-mpegurl; charset=utf-8');
  res.attachment(torrent.torrent.name + '.m3u');
  res.send('#EXTM3U\n' + torrent.files.map(function (f) {
      return '#EXTINF:-1,' + f.path + '\n' +
        proto + '://' + host + '/torrents/' + torrent.infoHash + '/files/' + encodeURIComponent(f.path);
    }).join('\n'));
});

api.all('/torrents/:infoHash/files/:path([^"]+)', findTorrent, function (req, res) {
  var torrent = req.torrent, file = _.find(torrent.files, { path: req.params.path });

  if (!file) {
    return res.sendStatus(404);
  }

  if (typeof req.query.ffmpeg !== 'undefined') {
    return require('./ffmpeg')(req, res, torrent, file);
  }

  var range = req.headers.range;
  range = range && rangeParser(file.length, range)[0];
  res.setHeader('Accept-Ranges', 'bytes');
  res.type(file.name);
  req.connection.setTimeout(3600000);

  if (!range) {
    res.setHeader('Content-Length', file.length);
    if (req.method === 'HEAD') {
      return res.end();
    }
    return pump(file.createReadStream(), res);
  }

  res.statusCode = 206;
  res.setHeader('Content-Length', range.end - range.start + 1);
  res.setHeader('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + file.length);

  if (req.method === 'HEAD') {
    return res.end();
  }
  pump(file.createReadStream(range), res);
});

api.get('/torrents/:infoHash/archive', findTorrent, function (req, res) {
  var torrent = req.torrent;

  res.attachment(torrent.torrent.name + '.zip');
  req.connection.setTimeout(3600000);

  var archive = archiver('zip');
  archive.on('warning', function (err) {
    console.error(err);
  });
  archive.on('error', function (err) {
    throw err;
  });

  pump(archive, res);

  torrent.files.forEach(function (f) {
    archive.append(f.createReadStream(), { name: f.path });
  });
  archive.finalize();
});

// Movies CRUD Routes
// GET /api/movies - Get all movies
api.get('/api/movies', function (req, res) {
  try {
    var movies = loadMovies();
    res.json(movies);
  } catch (err) {
    console.error('Error getting movies:', err);
    res.status(500).json({ error: 'Failed to load movies' });
  }
});

// GET /api/movies/:id - Get specific movie
api.get('/api/movies/:id', function (req, res) {
  try {
    var movie = findMovieById(req.params.id);
    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    res.json(movie);
  } catch (err) {
    console.error('Error getting movie:', err);
    res.status(500).json({ error: 'Failed to get movie' });
  }
});

// POST /api/movies - Add new movie
api.post('/api/movies', function (req, res) {
  try {
    var movies = loadMovies();
    var newMovie = req.body;
    
    // Validate required fields
    if (!newMovie.id || !newMovie.name || !newMovie.torrentFile || typeof newMovie.fileIndex !== 'number') {
      return res.status(400).json({ 
        error: 'Missing required fields: id, name, torrentFile, fileIndex' 
      });
    }
    
    // Check if movie with same ID already exists
    if (movies.find(function(m) { return m.id === newMovie.id; })) {
      return res.status(409).json({ error: 'Movie with this ID already exists' });
    }
    
    movies.push(newMovie);
    saveMovies(movies);
    res.status(201).json(newMovie);
  } catch (err) {
    console.error('Error adding movie:', err);
    res.status(500).json({ error: 'Failed to add movie' });
  }
});

// PUT /api/movies/:id - Update existing movie
api.put('/api/movies/:id', function (req, res) {
  try {
    var movies = loadMovies();
    var movieIndex = movies.findIndex(function(m) { return m.id === req.params.id; });
    
    if (movieIndex === -1) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    
    var updatedMovie = req.body;
    updatedMovie.id = req.params.id; // Ensure ID stays the same
    
    // Validate required fields
    if (!updatedMovie.name || !updatedMovie.torrentFile || typeof updatedMovie.fileIndex !== 'number') {
      return res.status(400).json({ 
        error: 'Missing required fields: name, torrentFile, fileIndex' 
      });
    }
    
    movies[movieIndex] = updatedMovie;
    saveMovies(movies);
    res.json(updatedMovie);
  } catch (err) {
    console.error('Error updating movie:', err);
    res.status(500).json({ error: 'Failed to update movie' });
  }
});

// DELETE /api/movies/:id - Delete movie
api.delete('/api/movies/:id', function (req, res) {
  try {
    var movies = loadMovies();
    var movieIndex = movies.findIndex(function(m) { return m.id === req.params.id; });
    
    if (movieIndex === -1) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    
    movies.splice(movieIndex, 1);
    saveMovies(movies);
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting movie:', err);
    res.status(500).json({ error: 'Failed to delete movie' });
  }
});

// GET /m3u8 - Generate M3U playlist
api.get('/m3u8', function (req, res) {
  try {
    var movies = loadMovies();
    var proto = req.get('x-forwarded-proto') || req.protocol;
    var host = req.get('x-forwarded-host') || req.get('host');
    
    res.setHeader('Content-Type', 'application/x-mpegurl; charset=utf-8');
    res.attachment('movies.m3u');
    
    var m3uContent = '#EXTM3U\n';
    movies.forEach(function(movie) {
      var tvgLogo = movie.image ? ' tvg-logo="' + movie.image + '"' : '';
      m3uContent += '#EXTINF:-1' + tvgLogo + ',' + movie.name + '\n';
      m3uContent += proto + '://' + host + '/stream/' + movie.id + '\n';
    });
    
    res.send(m3uContent);
  } catch (err) {
    console.error('Error generating M3U playlist:', err);
    res.status(500).json({ error: 'Failed to generate playlist' });
  }
});

// GET /stream/:id - Stream movie
api.get('/stream/:id', function (req, res) {
  try {
    var movie = findMovieById(req.params.id);
    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    
    // Add the torrent to the store
    store.add(movie.torrentFile, function (err, infoHash) {
      if (err) {
        console.error('Error adding torrent:', err);
        return res.status(500).json({ error: 'Failed to load torrent' });
      }
      
      var torrent = store.get(infoHash);
      if (!torrent) {
        return res.status(500).json({ error: 'Torrent not available' });
      }
      
      // Wait for torrent to be ready
      if (!torrent.ready) {
        torrent.on('ready', function() {
          streamFile();
        });
      } else {
        streamFile();
      }
      
      function streamFile() {
        var file = torrent.files[movie.fileIndex];
        if (!file) {
          return res.status(404).json({ error: 'File not found in torrent' });
        }
        
        // Handle range requests
        var range = req.headers.range;
        range = range && rangeParser(file.length, range)[0];
        res.setHeader('Accept-Ranges', 'bytes');
        res.type(file.name);
        req.connection.setTimeout(3600000);
        
        if (!range) {
          res.setHeader('Content-Length', file.length);
          if (req.method === 'HEAD') {
            return res.end();
          }
          return pump(file.createReadStream(), res);
        }
        
        res.statusCode = 206;
        res.setHeader('Content-Length', range.end - range.start + 1);
        res.setHeader('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + file.length);
        
        if (req.method === 'HEAD') {
          return res.end();
        }
        pump(file.createReadStream(range), res);
      }
    });
  } catch (err) {
    console.error('Error streaming movie:', err);
    res.status(500).json({ error: 'Failed to stream movie' });
  }
});

module.exports = api;
