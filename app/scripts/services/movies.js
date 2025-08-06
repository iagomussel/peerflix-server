'use strict';

angular.module('peerflixServerApp')
  .service('MoviesService', function ($resource, $http) {
    var Movie = $resource('/api/movies/:id', { id: '@id' }, {
      update: { method: 'PUT' }
    });

    return {
      // Get all movies
      getAll: function() {
        return Movie.query();
      },

      // Get movie by ID
      getById: function(id) {
        return Movie.get({ id: id });
      },

      // Create new movie
      create: function(movie) {
        return Movie.save(movie);
      },

      // Update existing movie
      update: function(id, movie) {
        return Movie.update({ id: id }, movie);
      },

      // Delete movie
      delete: function(id) {
        return Movie.delete({ id: id });
      },

      // Get M3U playlist
      getPlaylist: function() {
        return $http.get('/m3u8', {
          headers: { 'Accept': 'application/x-mpegurl' }
        });
      }
    };
  });