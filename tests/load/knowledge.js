import http from 'k6/http';
import { check, sleep } from 'k6';
if (__ENV.STAGING_ONLY !== 'true' || !__ENV.BASE_URL) throw new Error('Set STAGING_ONLY=true and BASE_URL for an isolated staging installation.');
const base = __ENV.BASE_URL.replace(/\/$/, '');
const users = Number(__ENV.MAX_VUS || 50);
if (!Number.isInteger(users) || users < 1 || users > 5000) throw new Error('MAX_VUS must be between 1 and 5000.');
export const options = {
 stages: [{ duration: '1m', target: Math.min(50, users) }, { duration: '2m', target: users }, { duration: '3m', target: users }, { duration: '30s', target: 0 }],
 thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<1000'], checks: ['rate>0.99'] },
};
export default function () {
 const page = http.get(`${base}/knowledge`, { tags: { name: 'knowledge_page' } });
 const articles = http.get(`${base}/api/knowledge?search=VPN`, { tags: { name: 'knowledge_search' } });
 check(page, { 'page available': response => response.status === 200 });
 check(articles, { 'knowledge search works': response => response.status === 200 && Array.isArray(response.json('articles')) });
 sleep(5);
}
