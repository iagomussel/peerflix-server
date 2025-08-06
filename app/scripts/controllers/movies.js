'use strict';

angular.module('peerflixServerApp')
  .controller('MoviesCtrl', function ($scope, MoviesService) {
    
    // Initialize scope variables
    $scope.movies = [];
    $scope.currentMovie = {};
    $scope.editMode = false;
    $scope.showForm = false;
    $scope.loading = false;
    $scope.error = null;
    $scope.success = null;

    // Load all movies
    function loadMovies() {
      $scope.loading = true;
      $scope.movies = MoviesService.getAll(function() {
        $scope.loading = false;
      }, function(error) {
        $scope.loading = false;
        $scope.error = 'Failed to load movies: ' + (error.data ? error.data.error : error.statusText);
      });
    }

    // Initialize
    loadMovies();

    // Show add movie form
    $scope.showAddForm = function() {
      $scope.currentMovie = {
        id: '',
        name: '',
        image: '',
        torrentFile: '',
        fileIndex: 0
      };
      $scope.editMode = false;
      $scope.showForm = true;
      $scope.error = null;
      $scope.success = null;
    };

    // Show edit movie form
    $scope.editMovie = function(movie) {
      $scope.currentMovie = angular.copy(movie);
      $scope.editMode = true;
      $scope.showForm = true;
      $scope.error = null;
      $scope.success = null;
    };

    // Cancel form
    $scope.cancelForm = function() {
      $scope.showForm = false;
      $scope.currentMovie = {};
      $scope.editMode = false;
      $scope.error = null;
      $scope.success = null;
    };

    // Save movie (create or update)
    $scope.saveMovie = function() {
      if (!$scope.currentMovie.id || !$scope.currentMovie.name || !$scope.currentMovie.torrentFile) {
        $scope.error = 'Please fill in all required fields (ID, Name, Torrent File)';
        return;
      }

      $scope.loading = true;
      $scope.error = null;

      if ($scope.editMode) {
        // Update existing movie
        MoviesService.update($scope.currentMovie.id, $scope.currentMovie).$promise
          .then(function(updatedMovie) {
            $scope.loading = false;
            $scope.success = 'Movie updated successfully!';
            
            // Update movie in the list
            var index = $scope.movies.findIndex(function(m) { return m.id === updatedMovie.id; });
            if (index !== -1) {
              $scope.movies[index] = updatedMovie;
            }
            
            $scope.showForm = false;
            $scope.currentMovie = {};
            $scope.editMode = false;
            
            // Clear success message after 3 seconds
            setTimeout(function() {
              $scope.$apply(function() {
                $scope.success = null;
              });
            }, 3000);
          })
          .catch(function(error) {
            $scope.loading = false;
            $scope.error = 'Failed to update movie: ' + (error.data ? error.data.error : error.statusText);
          });
      } else {
        // Create new movie
        MoviesService.create($scope.currentMovie).$promise
          .then(function(newMovie) {
            $scope.loading = false;
            $scope.success = 'Movie added successfully!';
            $scope.movies.unshift(newMovie);
            $scope.showForm = false;
            $scope.currentMovie = {};
            
            // Clear success message after 3 seconds
            setTimeout(function() {
              $scope.$apply(function() {
                $scope.success = null;
              });
            }, 3000);
          })
          .catch(function(error) {
            $scope.loading = false;
            $scope.error = 'Failed to add movie: ' + (error.data ? error.data.error : error.statusText);
          });
      }
    };

    // Delete movie
    $scope.deleteMovie = function(movie) {
      if (!confirm('Are you sure you want to delete "' + movie.name + '"?')) {
        return;
      }

      $scope.loading = true;
      MoviesService.delete(movie.id).$promise
        .then(function() {
          $scope.loading = false;
          $scope.success = 'Movie deleted successfully!';
          
          // Remove from list
          var index = $scope.movies.indexOf(movie);
          if (index !== -1) {
            $scope.movies.splice(index, 1);
          }
          
          // Clear success message after 3 seconds
          setTimeout(function() {
            $scope.$apply(function() {
              $scope.success = null;
            });
          }, 3000);
        })
        .catch(function(error) {
          $scope.loading = false;
          $scope.error = 'Failed to delete movie: ' + (error.data ? error.data.error : error.statusText);
        });
    };

    // Get stream URL
    $scope.getStreamUrl = function(movie) {
      return '/stream/' + movie.id;
    };

    // Download M3U playlist
    $scope.downloadPlaylist = function() {
      MoviesService.getPlaylist()
        .then(function(response) {
          var blob = new Blob([response.data], { type: 'application/x-mpegurl' });
          var url = window.URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'movies.m3u';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          
          $scope.success = 'Playlist downloaded successfully!';
          setTimeout(function() {
            $scope.$apply(function() {
              $scope.success = null;
            });
          }, 3000);
        })
        .catch(function(error) {
          $scope.error = 'Failed to download playlist: ' + (error.data ? error.data.error : error.statusText);
        });
    };

    // Clear messages
    $scope.clearMessages = function() {
      $scope.error = null;
      $scope.success = null;
    };
  });