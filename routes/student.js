const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');

const ensureStudent = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'student') {
    return res.redirect('/auth/login');
  }
  db.get(`SELECT profile_complete FROM profiles WHERE user_id = ?`, 
    [req.session.user.id], 
    (err, profile) => {
      if (err) {
        req.flash('error', 'Database error');
        return res.redirect('/auth/login');
      }
      if (!profile || !profile.profile_complete) {
        return res.redirect('/student/profile');
      }
      next();
    }
  );
};

router.get('/dashboard', ensureStudent, (req, res) => {
  db.all(`SELECT * FROM appointments WHERE student_id = ? AND status = 'pending'`, 
    [req.session.user.id], (err, appointments) => {
      if (err) {
        req.flash('error', 'Error fetching appointments');
        return res.redirect('/student/dashboard');
      }
      res.render('student/dashboard', { appointments, error: req.flash('error'), success: req.flash('success') });
    }
  );
});

router.get('/profile', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'student') {
    return res.redirect('/auth/login');
  }
  db.get(`SELECT * FROM profiles WHERE user_id = ?`, [req.session.user.id], (err, profile) => {
    if (err) {
      req.flash('error', 'Error fetching profile');
      return res.redirect('/student/profile');
    }
    res.render('student/profile', { profile, error: req.flash('error'), success: req.flash('success') });
  });
});

router.post('/profile', [
  body('id_number').trim().isLength({ min: 1 }).withMessage('ID number is required'),
  body('date_of_birth').isDate().withMessage('Invalid date of birth'),
  body('citizenship').trim().isLength({ min: 1 }).withMessage('Citizenship is required'),
  body('gender').isIn(['Male', 'Female', 'Other']).withMessage('Invalid gender'),
  body('marital_status').isIn(['Single', 'Married', 'Other']).withMessage('Invalid marital status'),
  body('cellphone_number').trim().isMobilePhone().withMessage('Invalid cellphone number')
], (req, res) => {
  if (!req.session.user || req.session.user.role !== 'student') {
    return res.redirect('/auth/login');
  }
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('student/profile', { profile: req.body, error: errors.array()[0].msg, success: null });
  }
  const { id_number, date_of_birth, citizenship, disability, gender, marital_status, cellphone_number } = req.body;
  const email = `${req.session.user.student_number}@ump.ac.za`;
  db.run(
    `INSERT OR REPLACE INTO profiles (user_id, id_number, date_of_birth, citizenship, disability, gender, marital_status, cellphone_number, email, profile_complete) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.session.user.id, id_number, date_of_birth, citizenship, disability, gender, marital_status, cellphone_number, email, 1],
    (err) => {
      if (err) {
        req.flash('error', 'Error updating profile');
        return res.redirect('/student/profile');
      }
      req.flash('success', 'Profile updated successfully');
      res.redirect('/student/dashboard');
    }
  );
});

router.get('/change-password', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'student') {
    return res.redirect('/auth/login');
  }
  res.render('student/change-password', { error: req.flash('error'), success: req.flash('success') });
});

router.post('/change-password', [
  body('new_password').trim().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('confirm_password').custom((value, { req }) => {
    if (value !== req.body.new_password) {
      throw new Error('Passwords do not match');
    }
    return true;
  })
], (req, res) => {
  if (!req.session.user || req.session.user.role !== 'student') {
    return res.redirect('/auth/login');
  }
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('student/change-password', { error: errors.array()[0].msg, success: null });
  }
  const { new_password } = req.body;
  if (new_password === 'Ump@2025') {
    return res.render('student/change-password', { error: 'Cannot use default password', success: null });
  }
  const hashedPassword = bcrypt.hashSync(new_password, 10);
  db.run(
    `UPDATE users SET password = ?, password_changed = 1 WHERE id = ?`,
    [hashedPassword, req.session.user.id],
    (err) => {
      if (err) {
        req.flash('error', 'Error updating password');
        return res.render('student/change-password', { error: 'Error updating password', success: null });
      }
      req.session.user.password_changed = 1;
      req.flash('success', 'Password updated successfully');
      res.redirect('/student/profile');
    }
  );
});

router.get('/appointments', ensureStudent, (req, res) => {
  res.render('student/appointments', { error: req.flash('error'), success: req.flash('success') });
});

router.post('/appointments', ensureStudent, [
  body('date').isDate().withMessage('Invalid date'),
  body('time').custom((value) => {
    const [hours, minutes] = value.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) {
      throw new Error('Invalid time format');
    }
    if (hours < 8 || hours > 17 || (hours === 17 && minutes > 0)) {
      throw new Error('Time must be between 08:00 and 17:00');
    }
    return true;
  }),
  body('reason').trim().isLength({ min: 1 }).withMessage('Reason is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('student/appointments', { error: errors.array()[0].msg, success: null });
  }

  const { date, time, reason } = req.body;
  const day = new Date(date).getDay();
  if (day === 0 || day === 6) {
    return res.render('student/appointments', { error: 'Appointments are only available Monday to Friday', success: null });
  }

  try {
    const existing = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as count FROM appointments WHERE date = ? AND time = ? AND status != 'cancelled'`,
        [date, time],
        (err, row) => {
          if (err) return reject(err);
          resolve(row ? row.count : 0);
        }
      );
    });

    if (existing > 0) {
      return res.render('student/appointments', { error: 'Time slot already booked', success: null });
    }

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO appointments (student_id, date, time, reason, status) VALUES (?, ?, ?, ?, ?)`,
        [req.session.user.id, date, time, reason, 'pending'],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });

    req.flash('success', 'Appointment booked successfully');
    res.redirect('/student/dashboard');
  } catch (err) {
    req.flash('error', 'Error booking appointment');
    res.render('student/appointments', { error: 'Error booking appointment', success: null });
  }
});

router.get('/history', ensureStudent, (req, res) => {
  db.all(
    `SELECT v.*, p.medication, p.dosage, p.instructions 
     FROM visits v LEFT JOIN prescriptions p ON v.id = p.visit_id 
     WHERE v.student_id = ?`,
    [req.session.user.id],
    (err, visits) => {
      if (err) {
        req.flash('error', 'Error fetching visit history');
        return res.redirect('/student/dashboard');
      }
      res.render('student/history', { visits, error: req.flash('error'), success: req.flash('success') });
    }
  );
});

module.exports = router;