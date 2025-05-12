export const environment = {
  production: false,
  spotify: {
    clientId: '07c159ba757f48c5b7ef975f2d661670', // Replace with your Spotify Client ID
    clientSecret: '421b070e0f094741bdf0b0791609fc44',
    redirectUri: 'com.soundwave://callback', // e.g., http://localhost:8100/callback
    authEndpoint: 'https://accounts.spotify.com/authorize',
    tokenEndpoint: 'https://accounts.spotify.com/api/token',
    apiEndpoint: 'https://api.spotify.com/v1'
  }
};
