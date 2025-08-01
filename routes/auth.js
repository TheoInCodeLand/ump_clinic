const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../database/db');

router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'student' ? '/student/dashboard' : '/staff/dashboard');
  }
  res.render('login', { error: req.flash('error'), success: req.flash('success') });
});

router.post('/login', [
  body('identifier').trim().isLength({ min: 1 }).withMessage('Student number or email is required'),
  body('password').isLength({ min: 1 }).withMessage('Password is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array()[0].msg);
    return res.render('login', { error: req.flash('error'), success: null });
  }

  const { identifier, password } = req.body;
  try {
    const user = await new Promise((resolve, reject) => {
      db.get(
        `SELECT u.*, p.profile_complete FROM users u 
         LEFT JOIN profiles p ON u.id = p.user_id 
         WHERE u.student_number = ? OR u.email = ?`,
        [identifier, identifier],
        (err, user) => {
          if (err) return reject(err);
          resolve(user);
        }
      );
    });

    if (!user) {
      req.flash('error', 'Invalid credentials');
      return res.render('login', { error: req.flash('error'), success: null });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      req.flash('error', 'Invalid credentials');
      return res.render('login', { error: req.flash('error'), success: null });
    }

    req.session.user = user;
    if (user.role === 'student') {
      if (!user.password_changed) {
        return res.redirect('/student/change-password');
      }
      if (!user.profile_complete) {
        return res.redirect('/student/profile');
      }
    }
    res.redirect(user.role === 'student' ? '/student/dashboard' : '/staff/dashboard');
  } catch (err) {
    console.error('Login error:', err.message);
    req.flash('error', 'Server error, please try again later');
    res.render('login', { error: req.flash('error'), success: null });
  }
});

router.get('/logout', (req, res) => {
  if (!req.session) {
    console.error('No session found during logout');
    return res.redirect('/');
  }
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err.message);
      req.flash('error', 'Error logging out, please try again');
      return res.redirect(req.session?.user?.role === 'student' ? '/student/dashboard' : '/staff/dashboard');
    }
    req.flash('success', 'Logged out successfully');
    res.redirect('/');
  });
});

module.exports = router;