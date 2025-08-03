const express = require('express');
const router = express.Router();
const db = require('../database/db');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const { body, validationResult } = require('express-validator');

const ensureStaff = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'staff') {
    req.flash('error', 'Staff access required');
    return res.redirect('/auth/login');
  }
  next();
};

router.get('/dashboard', ensureStaff, async (req, res) => {
  try {
    const appointments = await new Promise((resolve, reject) => {
      db.all(
        `SELECT a.*, u.name, u.surname FROM appointments a 
         JOIN users u ON a.student_id = u.id WHERE a.status = 'pending'`,
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
    res.render('staff/dashboard', {
      appointments,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    req.flash('error', 'Error fetching appointments');
    res.redirect('/staff/dashboard');
  }
});

router.get('/manage_appointments', ensureStaff, async (req, res) => {
  try {
    const appointments = await new Promise((resolve, reject) => {
      db.all(
        `SELECT a.*, u.name, u.surname FROM appointments a 
         JOIN users u ON a.student_id = u.id`,
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
    res.render('staff/manage_appointments', {
      appointments,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    console.error('Manage appointments error:', err.message);
    req.flash('error', 'Error fetching appointments');
    res.redirect('/staff/dashboard');
  }
});

router.post('/manage_appointments/:id', ensureStaff, [
  body('status').isIn(['pending', 'confirmed', 'cancelled']).withMessage('Invalid status')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array()[0].msg);
    return res.redirect('/staff/manage_appointments');
  }

  const { status } = req.body;
  try {
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE appointments SET status = ? WHERE id = ?`,
        [status, req.params.id],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
    req.flash('success', 'Appointment status updated successfully');
    res.redirect('/staff/manage_appointments');
  } catch (err) {
    console.error('Update appointment error:', err.message);
    req.flash('error', 'Error updating appointment status');
    res.redirect('/staff/manage_appointments');
  }
});

router.get('/manage_records', ensureStaff, async (req, res) => {
  try {
    const students = await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM users WHERE role = 'student'`, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
    res.render('staff/manage_records', {
      students,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    console.error('Manage records error:', err.message);
    req.flash('error', 'Error fetching student records');
    res.redirect('/staff/dashboard');
  }
});

router.get('/manage_records/:student_id/profile', ensureStaff, async (req, res) => {
  try {
    const student = await new Promise((resolve, reject) => {
      db.get(
        `SELECT u.*, p.* FROM users u 
         LEFT JOIN profiles p ON u.id = p.user_id 
         WHERE u.id = ? AND u.role = 'student'`,
        [req.params.student_id],
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });
    if (!student) {
      req.flash('error', 'Student not found');
      return res.render('error', { message: 'Student not found', error: req.flash('error'), success: req.flash('success') });
    }
    res.render('staff/view_student_profile', {
      student,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    console.error('View student profile error:', err.message);
    req.flash('error', 'Error fetching student profile');
    res.render('error', { message: 'Error fetching student profile', error: req.flash('error'), success: req.flash('success') });
  }
});

router.post('/manage_records/:student_id/visit', ensureStaff, [
  body('date').isDate().withMessage('Invalid date'),
  body('diagnosis').trim().isLength({ min: 1 }).withMessage('Diagnosis is required'),
  body('medication').optional({ checkFalsy: true }).trim().custom((value, { req }) => {
    if (value && !req.body.dosage) {
      throw new Error('Dosage is required if medication is provided');
    }
    if (!value && req.body.dosage) {
      throw new Error('Medication is required if dosage is provided');
    }
    return true;
  }),
  body('dosage').optional({ checkFalsy: true }).trim().isLength({ min: 1 }).withMessage('Dosage must not be empty if provided'),
  body('duration').optional({ checkFalsy: true }).isInt({ min: 1 }).withMessage('Duration must be a positive number of days')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array()[0].msg);
    return res.redirect('/staff/manage_records');
  }

  const { student_id } = req.params;
  const { date, diagnosis, notes, medication, dosage, instructions, duration } = req.body;

  try {
    // Verify student_id is a valid student
    const student = await new Promise((resolve, reject) => {
      db.get(`SELECT id FROM users WHERE id = ? AND role = 'student'`, [student_id], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
    if (!student) {
      req.flash('error', 'Invalid student ID');
      return res.redirect('/staff/manage_records');
    }

    await new Promise((resolve, reject) => {
      db.run('BEGIN TRANSACTION', async (err) => {
        if (err) return reject(err);
        try {
          const visitId = await new Promise((resolve, reject) => {
            db.run(
              `INSERT INTO visits (student_id, clinician_id, date, diagnosis, notes) 
               VALUES (?, ?, ?, ?, ?)`,
              [student_id, req.session.user.id, date, diagnosis, notes],
              function (err) {
                if (err) return reject(err);
                resolve(this.lastID);
              }
            );
          });
          if (medication && dosage) {
            await new Promise((resolve, reject) => {
              db.run(
                `INSERT INTO prescriptions (visit_id, medication, dosage, instructions, duration) 
                 VALUES (?, ?, ?, ?, ?)`,
                [visitId, medication, dosage, instructions, duration],
                (err) => {
                  if (err) return reject(err);
                  resolve();
                }
              );
            });
          }
          db.run('COMMIT', resolve);
        } catch (err) {
          db.run('ROLLBACK', () => reject(err));
        }
      });
    });
    req.flash('success', 'Visit and prescription added successfully');
    res.redirect('/staff/manage_records');
  } catch (err) {
    console.error('Add visit error:', err.message);
    req.flash('error', 'Error adding visit');
    res.redirect('/staff/manage_records');
  }
});

router.get('/manage_students', ensureStaff, async (req, res) => {
  try {
    const students = await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM users WHERE role = 'student'`, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
    res.render('staff/manage_students', {
      students,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    console.error('Manage students error:', err.message);
    req.flash('error', 'Error fetching students');
    res.redirect('/staff/dashboard');
  }
});

router.post('/manage_students/add', ensureStaff, [
  body('student_number').trim().isLength({ min: 1 }).withMessage('Student number is required'),
  body('name').trim().isLength({ min: 1 }).withMessage('Name is required'),
  body('surname').trim().isLength({ min: 1 }).withMessage('Surname is required'),
  body('id_number').trim().isLength({ min: 1 }).withMessage('ID number is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array()[0].msg);
    return res.redirect('/staff/manage_students');
  }

  const { student_number, name, surname, id_number } = req.body;
  const email = `${student_number}@ump.ac.za`;
  const defaultPassword = bcrypt.hashSync('Ump@2025', 10);

  try {
    await new Promise((resolve, reject) => {
      db.run('BEGIN TRANSACTION', async (err) => {
        if (err) return reject(err);
        try {
          const userId = await new Promise((resolve, reject) => {
            db.run(
              `INSERT INTO users (role, student_number, email, password, name, surname, password_changed) 
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              ['student', student_number, email, defaultPassword, name, surname, 0],
              function (err) {
                if (err) return reject(err);
                resolve(this.lastID);
              }
            );
          });
          await new Promise((resolve, reject) => {
            db.run(
              `INSERT INTO profiles (user_id, id_number, profile_complete) 
               VALUES (?, ?, ?)`,
              [userId, id_number, 0],
              (err) => {
                if (err) return reject(err);
                resolve();
              }
            );
          });
          db.run('COMMIT', resolve);
        } catch (err) {
          db.run('ROLLBACK', () => reject(err));
        }
      });
    });
    req.flash('success', 'Student added successfully');
    res.redirect('/staff/manage_students');
  } catch (err) {
    console.error('Add student error:', err.message);
    req.flash('error', 'Error adding student');
    res.redirect('/staff/manage_students');
  }
});

router.post('/manage_students/upload', ensureStaff, async (req, res) => {
  try {
    if (!req.file) {
      req.flash('error', 'No file uploaded');
      return res.redirect('/staff/manage_students');
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const students = XLSX.utils.sheet_to_json(sheet);

    const requiredColumns = ['student_number', 'name', 'surname', 'id_number'];
    const headers = Object.keys(students[0] || {});
    const missingColumns = requiredColumns.filter(col => !headers.includes(col));

    if (missingColumns.length > 0) {
      req.flash('error', `Missing required columns: ${missingColumns.join(', ')}`);
      return res.redirect('/staff/manage_students');
    }

    let successCount = 0;
    let errorCount = 0;

    await new Promise((resolve, reject) => {
      db.run('BEGIN TRANSACTION', async (err) => {
        if (err) return reject(err);
        try {
          for (const student of students) {
            const { student_number, name, surname, id_number } = student;
            if (!student_number || !name || !surname || !id_number) {
              errorCount++;
              continue;
            }
            const email = `${student_number}@ump.ac.za`;
            const defaultPassword = bcrypt.hashSync('Ump@2025', 10);

            await new Promise((resolve, reject) => {
              db.run(
                `INSERT OR IGNORE INTO users (role, student_number, email, password, name, surname, password_changed) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ['student', student_number, email, defaultPassword, name, surname, 0],
                function (err) {
                  if (err) return reject(err);
                  db.run(
                    `INSERT OR IGNORE INTO profiles (user_id, id_number, profile_complete) 
                     VALUES (?, ?, ?)`,
                    [this.lastID, id_number, 0],
                    (err) => {
                      if (err) return reject(err);
                      successCount++;
                      resolve();
                    }
                  );
                }
              );
            });
          }
          db.run('COMMIT', resolve);
        } catch (err) {
          db.run('ROLLBACK', () => reject(err));
        }
      });
    });

    req.flash('success', successCount ? `Successfully added ${successCount} students` : null);
    req.flash('error', errorCount ? `Failed to add ${errorCount} students` : null);
    res.redirect('/staff/manage_students');
  } catch (err) {
    console.error('Upload students error:', err.message);
    req.flash('error', 'Error processing file upload');
    res.redirect('/staff/manage_students');
  }
});

module.exports = router;