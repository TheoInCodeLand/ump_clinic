// tests/auth.test.js
const request = require('supertest');
const app = require('../app');
const db = require('../database/db');

describe('Auth Routes', () => {
  beforeAll((done) => {
    db.run('DELETE FROM users WHERE email = ?', ['test@ump.ac.za'], done);
  });

  it('should login staff with correct credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ identifier: 'admin@ump.ac.za', password: 'admin123' });
    expect(res.statusCode).toEqual(302);
    expect(res.headers.location).toEqual('/staff/dashboard');
  });

  it('should fail login with incorrect credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ identifier: 'admin@ump.ac.za', password: 'wrong' });
    expect(res.statusCode).toEqual(200);
    expect(res.text).toContain('Invalid credentials');
  });
});