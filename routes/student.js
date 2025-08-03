const express = require('express');
const router = express.Router();
const db = require('../database/db');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');

const ensureStudent = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'student') {
    req.flash('error', 'Student access required');
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

router.get('/dashboard', ensureStudent, async (req, res) => {
  try {
    // Fetch upcoming appointments (pending or confirmed, sorted by date)
    const appointments = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM appointments 
         WHERE student_id = ? AND status IN ('pending', 'confirmed') 
         AND date >= date('now') 
         ORDER BY date ASC, time ASC`,
        [req.session.user.id],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });

    // Fetch recent visits (last 2)
    const visits = await new Promise((resolve, reject) => {
      db.all(
        `SELECT v.*, p.medication, p.dosage, p.instructions, p.duration
         FROM visits v 
         LEFT JOIN prescriptions p ON v.id = p.visit_id 
         WHERE v.student_id = ?
         ORDER BY v.date DESC LIMIT 2`,
        [req.session.user.id],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });

    // Fetch active prescriptions
    const prescriptions = await new Promise((resolve, reject) => {
      db.all(
        `SELECT p.*, v.date AS visit_date 
         FROM prescriptions p 
         JOIN visits v ON p.visit_id = v.id 
         WHERE v.student_id = ? 
         AND date(v.date, '+' || p.duration || ' days') >= date('now')`,
        [req.session.user.id],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });

    // Check profile and password status
    const user = await new Promise((resolve, reject) => {
      db.get(
        `SELECT password_changed FROM users WHERE id = ?`,
        [req.session.user.id],
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });

    // Format data for display
    const currentDate = new Date();
    const enhancedAppointments = appointments.map(apt => {
      const aptDate = new Date(apt.date);
      apt.isTomorrow = aptDate.toDateString() === new Date(currentDate.getTime() + 24 * 60 * 60 * 1000).toDateString();
      return apt;
    });

    const enhancedPrescriptions = prescriptions.map(p => {
      const endDate = new Date(new Date(p.visit_date).getTime() + p.duration * 24 * 60 * 60 * 1000);
      p.daysLeft = Math.ceil((endDate - currentDate) / (24 * 60 * 60 * 1000));
      return p;
    });

    res.render('student/dashboard', {
      appointments: enhancedAppointments,
      visits,
      prescriptions: enhancedPrescriptions,
      profileComplete: true, // Ensured by ensureStudent
      passwordChanged: user.password_changed,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    req.flash('error', 'Error loading dashboard');
    res.redirect('/student/dashboard');
  }
});

router.post('/cancel_appointment/:id', ensureStudent, async (req, res) => {
  try {
    // Verify the appointment belongs to the student and is not already cancelled
    const appointment = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM appointments WHERE id = ? AND student_id = ? AND status IN ('pending', 'confirmed')`,
        [req.params.id, req.session.user.id],
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });

    if (!appointment) {
      req.flash('error', 'Appointment not found or cannot be cancelled');
      return res.redirect('/student/dashboard');
    }

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE appointments SET status = 'cancelled' WHERE id = ?`,
        [req.params.id],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });

    req.flash('success', 'Appointment cancelled successfully');
    res.redirect('/student/dashboard');
  } catch (err) {
    console.error('Cancel appointment error:', err.message);
    req.flash('error', 'Error cancelling appointment');
    res.redirect('/student/dashboard');
  }
});

router.get('/profile', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'student') {
    req.flash('error', 'Student access required');
    return res.redirect('/auth/login');
  }
  db.get(`SELECT * FROM profiles WHERE user_id = ?`, [req.session.user.id], (err, profile) => {
    if (err) {
      req.flash('error', 'Error fetching profile');
      return res.redirect('/student/profile');
    }
    res.render('student/profile', {
      profile,
      error: req.flash('error'),
      success: req.flash('success')
    });
  });
});

router.post('/profile', [
  body('id_number').trim().isLength({ min: 1 }).withMessage('ID number is required'),
  body('date_of_birth').isDate().withMessage('Invalid date of birth'),
  body('citizenship').trim().isLength({ min: 1 }).withMessage('Citizenship is required'),
  body('gender').isIn(['Male', 'Female', 'Other']).withMessage('Invalid gender'),
  body('marital_status').isIn(['Single', 'Married', 'Other']).withMessage('Invalid marital status'),
  body('cellphone_number').trim().isMobilePhone().withMessage('Invalid cellphone number')
], async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'student') {
    req.flash('error', 'Student access required');
    return res.redirect('/auth/login');
  }
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('student/profile', {
      profile: req.body,
      error: errors.array()[0].msg,
      success: null
    });
  }
  const { id_number, date_of_birth, citizenship, disability, gender, marital_status, cellphone_number } = req.body;
  const email = `${req.session.user.student_number}@ump.ac.za`;
  try {
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO profiles (user_id, id_number, date_of_birth, citizenship, disability, gender, marital_status, cellphone_number, email, profile_complete) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.session.user.id, id_number, date_of_birth, citizenship, disability, gender, marital_status, cellphone_number, email, 1],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
    req.flash('success', 'Profile updated successfully');
    res.redirect('/student/dashboard');
  } catch (err) {
    console.error('Profile update error:', err.message);
    req.flash('error', 'Error updating profile');
    res.redirect('/student/profile');
  }
});

router.get('/change-password', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'student') {
    req.flash('error', 'Student access required');
    return res.redirect('/auth/login');
  }
  res.render('student/change-password', {
    error: req.flash('error'),
    success: req.flash('success')
  });
});

router.post('/change-password', [
  body('new_password').trim().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('confirm_password').custom((value, { req }) => {
    if (value !== req.body.new_password) {
      throw new Error('Passwords do not match');
    }
    return true;
  })
], async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'student') {
    req.flash('error', 'Student access required');
    return res.redirect('/auth/login');
  }
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('student/change-password', {
      error: errors.array()[0].msg,
      success: null
    });
  }
  const { new_password } = req.body;
  if (new_password === 'Ump@2025') {
    return res.render('student/change-password', {
      error: 'Cannot use default password',
      success: null
    });
  }
  const hashedPassword = bcrypt.hashSync(new_password, 10);
  try {
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE users SET password = ?, password_changed = 1 WHERE id = ?`,
        [hashedPassword, req.session.user.id],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
    req.session.user.password_changed = 1;
    req.flash('success', 'Password updated successfully');
    res.redirect('/student/profile');
  } catch (err) {
    console.error('Password update error:', err.message);
    req.flash('error', 'Error updating password');
    res.render('student/change-password', {
      error: 'Error updating password',
      success: null
    });
  }
});

router.get('/appointments', ensureStudent, (req, res) => {
  res.render('student/appointments', {
    error: req.flash('error'),
    success: req.flash('success')
  });
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
    return res.render('student/appointments', {
      error: errors.array()[0].msg,
      success: null
    });
  }

  const { date, time, reason } = req.body;
  const day = new Date(date).getDay();
  if (day === 0 || day === 6) {
    return res.render('student/appointments', {
      error: 'Appointments are only available Monday to Friday',
      success: null
    });
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
      return res.render('student/appointments', {
        error: 'Time slot already booked',
        success: null
      });
    }

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO appointments (student_id, date, time, reason, status) 
         VALUES (?, ?, ?, ?, ?)`,
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
    console.error('Book appointment error:', err.message);
    req.flash('error', 'Error booking appointment');
    res.render('student/appointments', {
      error: 'Error booking appointment',
      success: null
    });
  }
});

router.get('/history', ensureStudent, async (req, res) => {
  try {
    const visits = await new Promise((resolve, reject) => {
      db.all(
        `SELECT v.*, p.medication, p.dosage, p.instructions, p.duration, 
                u.name AS clinician_name, u.surname AS clinician_surname
         FROM visits v 
         LEFT JOIN prescriptions p ON v.id = p.visit_id 
         LEFT JOIN users u ON v.clinician_id = u.id
         WHERE v.student_id = ?
         ORDER BY v.date DESC`,
        [req.session.user.id],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });

    // Calculate prescription status
    const currentDate = new Date();
    const enhancedVisits = visits.map(visit => {
      if (visit.medication && visit.duration) {
        const visitDate = new Date(visit.date);
        const endDate = new Date(visitDate.getTime() + visit.duration * 24 * 60 * 60 * 1000);
        visit.prescription_status = endDate >= currentDate ? 'Active' : 'Expired';
      }
      return visit;
    });

    res.render('student/history', {
      visits: enhancedVisits,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    console.error('History error:', err.message);
    req.flash('error', 'Error fetching visit history');
    res.redirect('/student/dashboard');
  }
});

module.exports = router;