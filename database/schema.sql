-- database/schema.sql
-- Run this file ONCE to create all tables in your MySQL database
-- How to run: mysql -u root -p pscrm < database/schema.sql
-- OR paste into phpMyAdmin → SQL tab and click Go

-- ── Create database if not exists ──────────────────────────────────────
CREATE DATABASE IF NOT EXISTS pscrm
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE pscrm;

-- ── Citizens (app users / public) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS citizens (
    id          VARCHAR(50)  PRIMARY KEY,
    name        VARCHAR(100),
    aadhaar     VARCHAR(12)  UNIQUE,
    mobile      VARCHAR(10)  UNIQUE,
    state       VARCHAR(100),
    district    VARCHAR(100),
    pincode     VARCHAR(10),
    verified_at DATETIME,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
);

-- ── Government departments ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
    id        VARCHAR(50)  PRIMARY KEY,
    name      VARCHAR(100) NOT NULL,
    sla_hours INT          DEFAULT 48,
    zone      VARCHAR(50)
);

-- ── Field officers and supervisors ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS officers (
    id                VARCHAR(50)  PRIMARY KEY,
    name              VARCHAR(100) NOT NULL,
    dept_id           VARCHAR(50),
    mobile            VARCHAR(10),
    current_lat       DECIMAL(10, 7) DEFAULT 28.6139000,
    current_lon       DECIMAL(10, 7) DEFAULT 77.2090000,
    is_active         TINYINT(1)   DEFAULT 1,
    active_complaints INT          DEFAULT 0,
    resolution_rate   DECIMAL(5,2) DEFAULT 95.00,
    shift_end         DATETIME,
    role              VARCHAR(20)  DEFAULT 'officer',
    created_at        DATETIME     DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dept_id) REFERENCES departments(id)
);

-- ── Complaints filed by citizens ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS complaints (
    id               VARCHAR(20)   PRIMARY KEY,
    citizen_id       VARCHAR(50),
    dept_id          VARCHAR(50),
    officer_id       VARCHAR(50),
    status           VARCHAR(30)   DEFAULT 'NEW',
    -- Allowed: NEW | ASSIGNED | IN_PROGRESS | HUMAN_REVIEW
    --          ESCALATED | SUPER_ESCALATED | AWAITING_INFO
    --          RESOLVED | CLOSED | REJECTED | SPLIT
    description      TEXT,
    photo_path       VARCHAR(255),
    lat              DECIMAL(10,7),
    lon              DECIMAL(10,7),
    address          TEXT,
    state            VARCHAR(100),
    district         VARCHAR(100),
    pincode          VARCHAR(10),
    severity         VARCHAR(20)   DEFAULT 'medium',
    priority         VARCHAR(20)   DEFAULT 'medium',
    trust_score      DECIMAL(5,2)  DEFAULT 0.00,
    signal_log       JSON,
    sla_deadline     DATETIME,
    reviewed_by      VARCHAR(50),
    review_action    VARCHAR(50),
    rejection_reason TEXT,
    citizen_rating   TINYINT,
    created_at       DATETIME      DEFAULT CURRENT_TIMESTAMP,
    resolved_at      DATETIME,
    FOREIGN KEY (citizen_id)  REFERENCES citizens(id),
    FOREIGN KEY (dept_id)     REFERENCES departments(id),
    FOREIGN KEY (officer_id)  REFERENCES officers(id)
);

-- ── Audit trail — every state change logged ─────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    id           INT          AUTO_INCREMENT PRIMARY KEY,
    complaint_id VARCHAR(20),
    action       VARCHAR(50)  NOT NULL,
    actor_id     VARCHAR(50),
    actor_role   VARCHAR(20)  DEFAULT 'system',
    note         TEXT,
    created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (complaint_id) REFERENCES complaints(id)
);

-- ── OTP storage (short-lived) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_store (
    mobile     VARCHAR(10)  PRIMARY KEY,
    otp        VARCHAR(6)   NOT NULL,
    attempts   TINYINT      DEFAULT 0,
    expires_at DATETIME     NOT NULL,
    created_at DATETIME     DEFAULT CURRENT_TIMESTAMP
);

-- ── Notification log ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_log (
    id         INT          AUTO_INCREMENT PRIMARY KEY,
    citizen_id VARCHAR(50),
    mobile     VARCHAR(10),
    message    TEXT,
    channel    VARCHAR(20)  DEFAULT 'sms',
    status     VARCHAR(20)  DEFAULT 'pending',
    created_at DATETIME     DEFAULT CURRENT_TIMESTAMP
);

-- ── Seed departments ────────────────────────────────────────────────────
INSERT IGNORE INTO departments (id, name, sla_hours, zone) VALUES
    ('dept_pwd',   'Public Works Department', 48, 'zone_A'),
    ('dept_mcd',   'Municipal Corporation',   24, 'zone_A'),
    ('dept_elec',  'Electricity Board',       12, 'zone_B'),
    ('dept_water', 'Water Supply Board',      24, 'zone_B'),
    ('dept_pol',   'Police',                   6, 'zone_A');

-- ── Seed officers ───────────────────────────────────────────────────────
INSERT IGNORE INTO officers
    (id, name, dept_id, mobile, current_lat, current_lon,
     is_active, active_complaints, resolution_rate, shift_end)
VALUES
    ('off_01','Ramesh Kumar',   'dept_pwd',   '9811001001', 28.6139, 77.2090, 1, 2, 88.00, DATE_ADD(NOW(), INTERVAL 8 HOUR)),
    ('off_02','Suresh Sharma',  'dept_pwd',   '9811001002', 28.6200, 77.2150, 1, 1, 92.00, DATE_ADD(NOW(), INTERVAL 8 HOUR)),
    ('off_03','Priya Singh',    'dept_mcd',   '9811001003', 28.6100, 77.2050, 1, 3, 85.00, DATE_ADD(NOW(), INTERVAL 8 HOUR)),
    ('off_04','Anjali Verma',   'dept_mcd',   '9811001004', 28.6300, 77.2200, 1, 0, 95.00, DATE_ADD(NOW(), INTERVAL 8 HOUR)),
    ('off_05','Vikram Yadav',   'dept_elec',  '9811001005', 28.6050, 77.1980, 1, 1, 90.00, DATE_ADD(NOW(), INTERVAL 8 HOUR)),
    ('off_06','Deepak Patel',   'dept_water', '9811001006', 28.6180, 77.2120, 1, 2, 87.00, DATE_ADD(NOW(), INTERVAL 8 HOUR)),
    ('off_07','Neha Gupta',     'dept_pol',   '9811001007', 28.6250, 77.2080, 1, 0, 98.00, DATE_ADD(NOW(), INTERVAL 8 HOUR));

INSERT INTO citizens (id, name, aadhaar, mobile, state, district, pincode, verified_at)
VALUES 
    ('cit_101', 'Anjali Gupta', '987654321098', '9123456789', 'Karnataka', 'Bengaluru', '560001', NULL),
     ('cit_102', 'Vikram Singh', '456789012345', '9988776655', 'Delhi', 'New Delhi', '110001', '2026-03-23 11:00:00'),
    ('cit_103', 'Sanya Iyer', '234567890123', '9845098765', 'Tamil Nadu', 'Chennai', '600001', NULL, CURRENT_TIMESTAMP),
    ('cit_104', 'Amit Singh', '345678901234', '9910011223', 'Uttar Pradesh', 'Lucknow', '226001', '2026-03-22 14:15:00', '2026-03-21 18:00:00'),
    ('cit_105', 'Megha Rao', '456789012356', '9741000555', 'Karnataka', 'Mysuru', '570001', NULL, CURRENT_TIMESTAMP),
    ('cit_106', 'Gopal Krishnan', '567890123456', '9444012345', 'Kerala', 'Thiruvananthapuram', '695001', '2026-01-15 09:00:00', '2026-01-10 12:00:00'),
    ('cit_107', 'Debarati Bose', '678901234567', '9830065432', 'West Bengal', 'Kolkata', '700001', '2026-03-24 11:00:00', '2026-03-24 08:30:00');

-------complaints--------------------
INSERT IGNORE INTO complaints (
    id, citizen_id, dept_id, officer_id, status, description, 
    lat, lon, address, severity, sla_deadline
) VALUES 
('CMP-001', 'cit_101', 'dept_pwd', NULL, 'NEW', 'Large pothole on MG Road.', 19.07, 72.87, 'Mumbai', 'medium', DATE_ADD(NOW(), INTERVAL 2 DAY)),
('CMP-002', 'cit_102', 'dept_mcd', 'off_03', 'IN_PROGRESS', 'Garbage overflow.', 28.61, 77.20, 'Delhi', 'high', DATE_ADD(NOW(), INTERVAL 1 DAY));

-- ── Audit trail ─────────────────────────────
INSERT IGNORE INTO audit_log (complaint_id, action, actor_id, actor_role, note) VALUES 
('CMP-002', 'ASSIGNMENT', 'DEPT_HEAD', 'admin', 'Assigned to Priya Singh.'),
('CMP-002', 'STATUS_CHANGE', 'off_03', 'officer', 'Cleanup crew dispatched.');

-- ── OTP storage  ───────────────────────────────────────────
INSERT IGNORE INTO otp_store (mobile, otp, expires_at) VALUES 
('9123456789', '524109', DATE_ADD(NOW(), INTERVAL 5 MINUTE));

-- ── Notification log ────────────────────────────────────────────────────
INSERT IGNORE INTO notification_log (citizen_id, mobile, message, status) VALUES 
('cit_101', '9123456789', 'Your complaint CMP-001 has been received.', 'sent');