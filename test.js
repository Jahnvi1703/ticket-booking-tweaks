import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    flash_sale: {
      executor: 'shared-iterations',
      vus: 300,              // 500 concurrent connections
      iterations: 10000,     // 10,000 total requests
      maxDuration: '2m',     // Give it 2 minutes so 0 iterations get dropped
    },
  },
  thresholds: {
    // Defines that at least 90% of requests must receive either 202 or 409
    'checks': ['rate>0.90'],
  },
};

export default function () {
  const url = 'http://localhost:5000/api/memoryTickets';
  const payload = JSON.stringify({ eventId: 8 });
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6Niwicm9sZSI6IkNVU1RPTUVSIiwiZW1haWwiOiJyYWRoaWtleWRhc2kuMTMxMEBnbWFpbC5jb20iLCJpYXQiOjE3OTQ5MzE5MDcsImV4cCI6MTc5NTAxODMwN30.1SJ_lkltT4O_zqSxW29e4_3zysjmlMf45jK8OcjrrCs',
    },
    // Tells k6 NOT to treat 409 as an HTTP failure
    responseCallback: http.expectedStatuses(200, 201, 202, 409),
  };

  const res = http.post(url, payload, params);

  check(res, {
    'handled cleanly (202 or 409)': (r) => r.status === 202 || r.status === 409,
  });
}