const http = require('http');

http.get('http://localhost:4000/api/design-track?search=15', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('API Status Code:', res.statusCode);
    console.log('API Response:', data);
  });
}).on('error', err => console.log('HTTP Error:', err.message));
