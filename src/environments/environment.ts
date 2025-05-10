export const environment = {
  production: false,
  spotify: {
    clientId: 'e9f995a0dc5a418ea6af7e393ebceb00', // Replace with your Spotify Client ID
    clientSecret: '260ccb800c084651a0581575edddd402',
    redirectUri: 'http://127.0.0.1:3000', // e.g., http://localhost:8100/callback
    authEndpoint: 'https://accounts.spotify.com/authorize',
    tokenEndpoint: 'https://accounts.spotify.com/api/token',
    apiEndpoint: 'https://api.spotify.com/v1'
  }
};
