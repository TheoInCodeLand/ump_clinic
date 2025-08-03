const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database(path.join(__dirname, 'clinic.db'), (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

db.serialize(() => {
  // Users table: Stores student and staff accounts
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK(role IN ('student', 'staff')),
      student_number TEXT UNIQUE,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT,
      surname TEXT,
      password_changed BOOLEAN DEFAULT 0
    )
  `);

  // Profiles table: Stores student profile details
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      user_id INTEGER PRIMARY KEY,
      id_number TEXT,
      date_of_birth TEXT,
      citizenship TEXT,
      disability TEXT,
      gender TEXT CHECK(gender IN ('Male', 'Female', 'Other')),
      marital_status TEXT CHECK(marital_status IN ('Single', 'Married', 'Other')),
      cellphone_number TEXT,
      email TEXT,
      profile_complete BOOLEAN DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Appointments table: Stores student appointment bookings
  db.run(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'confirmed', 'cancelled')),
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Visits table: Stores medical visit records
  db.run(`
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      clinician_id INTEGER,
      date TEXT NOT NULL,
      diagnosis TEXT NOT NULL,
      notes TEXT,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (clinician_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Prescriptions table: Stores prescriptions linked to visits
  db.run(`
    CREATE TABLE IF NOT EXISTS prescriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id INTEGER,
      medication TEXT NOT NULL,
      dosage TEXT NOT NULL,
      instructions TEXT,
      duration TEXT,
      FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_student_number ON users(student_number)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_appointments_student_id ON appointments(student_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_visits_student_id ON visits(student_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_prescriptions_visit_id ON prescriptions(visit_id)`);

  // Seed admin staff account
  const adminPassword = bcrypt.hashSync('admin123', 10);
  db.run(
    `INSERT OR IGNORE INTO users (role, email, password, name, surname, password_changed) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['staff', 'admin@ump.ac.za', adminPassword, 'Clinic', 'Admin', 1],
    (err) => {
      if (err) {
        console.error('Error seeding admin:', err.message);
      } else {
        console.log('Admin account seeded successfully.');
      }
    }
  );
});

module.exports = db;