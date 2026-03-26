const token = process.env.FOOTBALL_DATA_API_TOKEN;

console.log('Token present:', !!token, '| Length:', token?.length || 0);

if (!token) {
  console.error('Missing FOOTBALL_DATA_API_TOKEN');
  process.exit(1);
}

const res = await fetch('https://api.football-data.org/v4/competitions', {
  headers: { 'X-Auth-Token': token }
});

console.log('API status:', res.status);

let data;
try {
  data = await res.json();
} catch {
  const txt = await res.text();
  data = { parseError: true, body: txt.slice(0, 300) };
}

console.log('Response:', JSON.stringify(data).slice(0, 300));

if (!res.ok) process.exit(1);
