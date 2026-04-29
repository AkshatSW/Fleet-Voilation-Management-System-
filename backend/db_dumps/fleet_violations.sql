--
-- PostgreSQL database dump
--

\restrict dDPH4jmZl5eCkbytdGgaxoobGYuTL1mNugdrj3csGqg4S3bUil8fdMQgqnaYCJS

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: cameras; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cameras (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    camera_type character varying(50) NOT NULL,
    location character varying(255),
    vehicle_id integer,
    api_key character varying(64) NOT NULL,
    status character varying(20),
    last_heartbeat timestamp without time zone,
    stream_url character varying(500),
    current_driver_id integer,
    current_vehicle_id integer,
    created_at timestamp without time zone,
    updated_at timestamp without time zone
);


--
-- Name: cameras_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cameras_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cameras_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cameras_id_seq OWNED BY public.cameras.id;


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    country character varying(100),
    created_at timestamp without time zone
);


--
-- Name: companies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.companies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: companies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.companies_id_seq OWNED BY public.companies.id;


--
-- Name: drivers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drivers (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    employee_id character varying(100) NOT NULL,
    vehicle_id integer,
    country character varying(100),
    active boolean,
    user_id integer
);


--
-- Name: drivers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.drivers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: drivers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.drivers_id_seq OWNED BY public.drivers.id;


--
-- Name: safety_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safety_scores (
    id integer NOT NULL,
    driver_id integer NOT NULL,
    month character varying(7) NOT NULL,
    total_penalty integer,
    final_score integer,
    risk_level character varying(50),
    created_at timestamp without time zone
);


--
-- Name: safety_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.safety_scores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: safety_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.safety_scores_id_seq OWNED BY public.safety_scores.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    full_name character varying(200),
    role character varying(20) NOT NULL,
    company_id integer,
    created_at timestamp without time zone,
    fcm_token character varying(500)
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicles (
    id integer NOT NULL,
    plate_number character varying(50) NOT NULL,
    model character varying(255),
    company_id integer NOT NULL,
    status character varying(50)
);


--
-- Name: vehicles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vehicles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vehicles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vehicles_id_seq OWNED BY public.vehicles.id;


--
-- Name: violations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.violations (
    id integer NOT NULL,
    driver_id integer NOT NULL,
    vehicle_id integer NOT NULL,
    event_type character varying(100) NOT NULL,
    severity character varying(50) NOT NULL,
    penalty_points integer NOT NULL,
    "timestamp" timestamp without time zone NOT NULL,
    latitude double precision,
    longitude double precision,
    speed integer,
    video_url character varying(500),
    snapshot_url character varying(500),
    clip_url character varying(500),
    review_status character varying(20),
    reviewed_by integer,
    reviewed_at timestamp without time zone,
    review_notes text,
    created_at timestamp without time zone
);


--
-- Name: violations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.violations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: violations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.violations_id_seq OWNED BY public.violations.id;


--
-- Name: cameras id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cameras ALTER COLUMN id SET DEFAULT nextval('public.cameras_id_seq'::regclass);


--
-- Name: companies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies ALTER COLUMN id SET DEFAULT nextval('public.companies_id_seq'::regclass);


--
-- Name: drivers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers ALTER COLUMN id SET DEFAULT nextval('public.drivers_id_seq'::regclass);


--
-- Name: safety_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_scores ALTER COLUMN id SET DEFAULT nextval('public.safety_scores_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: vehicles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles ALTER COLUMN id SET DEFAULT nextval('public.vehicles_id_seq'::regclass);


--
-- Name: violations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.violations ALTER COLUMN id SET DEFAULT nextval('public.violations_id_seq'::regclass);


--
-- Data for Name: cameras; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cameras (id, name, camera_type, location, vehicle_id, api_key, status, last_heartbeat, stream_url, current_driver_id, current_vehicle_id, created_at, updated_at) FROM stdin;
1	DXB-A Dashcam Front	dashcam	Front windshield, DXB-A-10000	1	cam-dxb-a-front-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa	offline	\N	\N	\N	\N	2026-04-29 13:48:04.300464	2026-04-29 13:48:04.300464
2	DXB-A Cabin Camera	cabin	Cabin interior, DXB-A-10000	1	cam-dxb-a-cabin-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb	offline	\N	\N	\N	\N	2026-04-29 13:48:04.300464	2026-04-29 13:48:04.300464
3	DXB-B Dashcam Front	dashcam	Front windshield, DXB-B-11111	2	cam-dxb-b-front-cccccccccccccccccccccccccccccccccccccccccccccccc	offline	\N	\N	\N	\N	2026-04-29 13:48:04.300464	2026-04-29 13:48:04.300464
4	Warehouse Entrance Camera	external	Al-Futtaim Logistics Warehouse Gate	\N	cam-warehouse-ext-dddddddddddddddddddddddddddddddddddddddddddddd	offline	\N	\N	\N	\N	2026-04-29 13:48:04.300464	2026-04-29 13:48:04.300464
5	Demo Webcam	webcam	Browser-based detection	\N	demo-webcam-api-key-for-testing-1234567890abcdef0123456789abcdef	offline	\N	\N	\N	\N	2026-04-29 13:48:04.300464	2026-04-29 13:48:04.300464
\.


--
-- Data for Name: companies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.companies (id, name, country, created_at) FROM stdin;
1	Al-Futtaim Logistics	UAE	2026-04-29 13:48:04.300464
2	Aramex Fleet Services	Saudi Arabia	2026-04-29 13:48:04.300464
\.


--
-- Data for Name: drivers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.drivers (id, name, employee_id, vehicle_id, country, active, user_id) FROM stdin;
1	Ahmed Khan	EMP-001	1	UAE	t	4
\.


--
-- Data for Name: safety_scores; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.safety_scores (id, driver_id, month, total_penalty, final_score, risk_level, created_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, username, password_hash, full_name, role, company_id, created_at, fcm_token) FROM stdin;
1	admin	$2b$12$xbauefqE3dTCn3o4FsKdRuBYeVErHiX8gndW603LlyPiRKW4RpxRO	System Admin	ADMIN	1	2026-04-29 13:48:04.300464	\N
2	manager	$2b$12$YEzcX2FSTHAGbe0wsMfv0uXABh6AtRJx866Nws1QlCyvRvUxc.opu	Fleet Manager	MANAGER	1	2026-04-29 13:48:04.300464	\N
3	viewer	$2b$12$lNHf6h2DbijSHCkUHnMmquKXbQjDLdzx7PvpV93.FvvOxlIm5fhL6	Report Viewer	VIEWER	1	2026-04-29 13:48:04.300464	\N
4	driver1	$2b$12$N.fGrDmNFZNV6K3yTWjsa.8Y/1jxMz/cynnJk8E4AydPrlZ3LVSSW	Ahmed Khan	DRIVER	1	2026-04-29 13:48:04.300464	\N
\.


--
-- Data for Name: vehicles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vehicles (id, plate_number, model, company_id, status) FROM stdin;
1	DXB-A-10000	Toyota Hilux	1	active
2	DXB-B-11111	Mitsubishi Canter	1	active
3	DXB-C-12222	Isuzu NPR	1	active
4	DXB-D-13333	Ford Transit	1	active
5	DXB-E-14444	MAN TGE	1	active
6	DXB-F-15555	Mercedes Sprinter	1	active
7	DXB-G-16666	Nissan Urvan	1	active
8	DXB-H-17777	Hyundai H-1	1	active
9	DXB-I-18888	Toyota HiAce	1	active
10	DXB-J-19999	Isuzu Elf	1	maintenance
11	RUH-A-20000	Toyota Hilux	2	active
12	RUH-B-22222	Mitsubishi Canter	2	active
13	RUH-C-24444	Isuzu NPR	2	active
14	RUH-D-26666	Ford Transit	2	active
15	RUH-E-28888	MAN TGE	2	retired
\.


--
-- Data for Name: violations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.violations (id, driver_id, vehicle_id, event_type, severity, penalty_points, "timestamp", latitude, longitude, speed, video_url, snapshot_url, clip_url, review_status, reviewed_by, reviewed_at, review_notes, created_at) FROM stdin;
\.


--
-- Name: cameras_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.cameras_id_seq', 5, true);


--
-- Name: companies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.companies_id_seq', 2, true);


--
-- Name: drivers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.drivers_id_seq', 1, true);


--
-- Name: safety_scores_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.safety_scores_id_seq', 1, false);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 4, true);


--
-- Name: vehicles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vehicles_id_seq', 15, true);


--
-- Name: violations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.violations_id_seq', 1, false);


--
-- Name: cameras cameras_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cameras
    ADD CONSTRAINT cameras_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: drivers drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);


--
-- Name: drivers drivers_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_user_id_key UNIQUE (user_id);


--
-- Name: safety_scores safety_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_scores
    ADD CONSTRAINT safety_scores_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- Name: violations violations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.violations
    ADD CONSTRAINT violations_pkey PRIMARY KEY (id);


--
-- Name: ix_cameras_api_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_cameras_api_key ON public.cameras USING btree (api_key);


--
-- Name: ix_cameras_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cameras_id ON public.cameras USING btree (id);


--
-- Name: ix_companies_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_companies_id ON public.companies USING btree (id);


--
-- Name: ix_drivers_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_drivers_employee_id ON public.drivers USING btree (employee_id);


--
-- Name: ix_drivers_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_drivers_id ON public.drivers USING btree (id);


--
-- Name: ix_safety_scores_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_safety_scores_id ON public.safety_scores USING btree (id);


--
-- Name: ix_users_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_users_id ON public.users USING btree (id);


--
-- Name: ix_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_username ON public.users USING btree (username);


--
-- Name: ix_vehicles_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_vehicles_id ON public.vehicles USING btree (id);


--
-- Name: ix_vehicles_plate_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_vehicles_plate_number ON public.vehicles USING btree (plate_number);


--
-- Name: ix_violations_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_violations_event_type ON public.violations USING btree (event_type);


--
-- Name: ix_violations_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_violations_id ON public.violations USING btree (id);


--
-- Name: ix_violations_review_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_violations_review_status ON public.violations USING btree (review_status);


--
-- Name: ix_violations_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_violations_timestamp ON public.violations USING btree ("timestamp");


--
-- Name: cameras cameras_current_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cameras
    ADD CONSTRAINT cameras_current_driver_id_fkey FOREIGN KEY (current_driver_id) REFERENCES public.drivers(id);


--
-- Name: cameras cameras_current_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cameras
    ADD CONSTRAINT cameras_current_vehicle_id_fkey FOREIGN KEY (current_vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: cameras cameras_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cameras
    ADD CONSTRAINT cameras_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: drivers drivers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: drivers drivers_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: safety_scores safety_scores_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_scores
    ADD CONSTRAINT safety_scores_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id);


--
-- Name: users users_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: vehicles vehicles_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: violations violations_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.violations
    ADD CONSTRAINT violations_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id);


--
-- Name: violations violations_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.violations
    ADD CONSTRAINT violations_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: violations violations_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.violations
    ADD CONSTRAINT violations_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- PostgreSQL database dump complete
--

\unrestrict dDPH4jmZl5eCkbytdGgaxoobGYuTL1mNugdrj3csGqg4S3bUil8fdMQgqnaYCJS

