--
-- PostgreSQL database dump
--

-- Dumped from database version 17.4
-- Dumped by pg_dump version 17.2

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: osm_cache; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.osm_cache (
    osm_id bigint NOT NULL,
    osm_type text NOT NULL,
    name text,
    tags jsonb,
    geom extensions.geometry(Geometry,4326),
    bbox extensions.geometry,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.osm_cache OWNER TO postgres;

--
-- Name: selections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.selections (
    id bigint NOT NULL,
    participant_id uuid,
    theme_id integer,
    osm_id bigint,
    importance_1_5 smallint,
    comment text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.selections OWNER TO postgres;

--
-- Name: themes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.themes (
    id integer NOT NULL,
    code text NOT NULL
);


ALTER TABLE public.themes OWNER TO postgres;

--
-- Name: user_polygons; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_polygons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    participant_id uuid NOT NULL,
    theme_id integer NOT NULL,
    name text NOT NULL,
    importance_1_5 integer DEFAULT 3 NOT NULL,
    comment text,
    geom extensions.geometry(MultiPolygon,4326) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_polygons OWNER TO postgres;

--
-- Name: v_manual_polygons; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_manual_polygons AS
 SELECT up.id,
    up.participant_id,
    up.theme_id,
    t.code AS theme_code,
    up.name,
    up.importance_1_5,
    up.comment,
    up.created_at,
    up.geom
   FROM (public.user_polygons up
     JOIN public.themes t ON ((t.id = up.theme_id)));


ALTER VIEW public.v_manual_polygons OWNER TO postgres;

--
-- Name: v_osm_polygons; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_osm_polygons AS
 SELECT osm_id,
    osm_type,
    name,
    tags,
    (extensions.st_multi(extensions.st_collectionextract(geom, 3)))::extensions.geometry(MultiPolygon,4326) AS geom
   FROM public.osm_cache
  WHERE ((geom IS NOT NULL) AND (extensions.geometrytype(extensions.st_collectionextract(geom, 3)) = ANY (ARRAY['POLYGON'::text, 'MULTIPOLYGON'::text])));


ALTER VIEW public.v_osm_polygons OWNER TO postgres;

--
-- Name: v_osm_polygons_selected; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_osm_polygons_selected AS
 SELECT s.id,
    s.participant_id,
    s.theme_id,
    t.code AS theme_code,
    s.osm_id,
    s.importance_1_5,
    s.comment,
    s.created_at,
    o.name,
    o.tags,
    o.geom
   FROM ((public.selections s
     JOIN public.v_osm_polygons o ON ((o.osm_id = s.osm_id)))
     JOIN public.themes t ON ((t.id = s.theme_id)));


ALTER VIEW public.v_osm_polygons_selected OWNER TO postgres;

--
-- Name: v_all_polygons; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_all_polygons AS
 SELECT row_number() OVER () AS gid,
    source,
    rec_id,
    participant_id,
    theme_id,
    theme_code,
    name,
    importance_1_5,
    comment,
    created_at,
    geom
   FROM ( SELECT 'manual'::text AS source,
            (v_manual_polygons.id)::text AS rec_id,
            v_manual_polygons.participant_id,
            v_manual_polygons.theme_id,
            v_manual_polygons.theme_code,
            v_manual_polygons.name,
            v_manual_polygons.importance_1_5,
            v_manual_polygons.comment,
            v_manual_polygons.created_at,
            v_manual_polygons.geom
           FROM public.v_manual_polygons
        UNION ALL
         SELECT 'osm'::text AS source,
            (v_osm_polygons_selected.id)::text AS rec_id,
            v_osm_polygons_selected.participant_id,
            v_osm_polygons_selected.theme_id,
            v_osm_polygons_selected.theme_code,
            v_osm_polygons_selected.name,
            v_osm_polygons_selected.importance_1_5,
            v_osm_polygons_selected.comment,
            v_osm_polygons_selected.created_at,
            v_osm_polygons_selected.geom
           FROM public.v_osm_polygons_selected) src;


ALTER VIEW public.v_all_polygons OWNER TO postgres;

--
-- Name: landmark_selection; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.landmark_selection (
    id bigint NOT NULL,
    participant_id uuid,
    theme_id smallint,
    osm_id bigint NOT NULL,
    osm_type text NOT NULL,
    name text,
    relevance smallint,
    frequency text,
    geom extensions.geometry(Point,4326),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.landmark_selection OWNER TO postgres;

--
-- Name: landmark_selection_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.landmark_selection ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.landmark_selection_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: osm_cache.geom; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."osm_cache.geom" (
    osm_id bigint NOT NULL,
    geom extensions.geometry(Point,4326)
);


ALTER TABLE public."osm_cache.geom" OWNER TO postgres;

--
-- Name: participant; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.participant (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    age_group text,
    gender text,
    race_ethnicity text,
    nationality text,
    education text,
    income_band text,
    housing_status text,
    housing_effort_percent integer,
    lives_in_lisbon boolean,
    lives_parish text,
    works_in_lisbon boolean,
    works_parish text,
    studies_in_lisbon boolean,
    transit_use text,
    main_mode text,
    belonging_score smallint,
    safety_day_score smallint,
    safety_night_score smallint
);


ALTER TABLE public.participant OWNER TO postgres;

--
-- Name: participant_note; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.participant_note (
    participant_id uuid NOT NULL,
    note text
);


ALTER TABLE public.participant_note OWNER TO postgres;

--
-- Name: participants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.participants OWNER TO postgres;

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.profiles (
    participant_id uuid NOT NULL,
    age_band text NOT NULL,
    gender text NOT NULL,
    ethnicity text,
    nationality text,
    education text,
    income_band text,
    tenure text,
    rent_stress_pct integer,
    lives_in_lisbon boolean NOT NULL,
    parish_home text,
    years_in_lisbon_band text,
    works_in_lisbon boolean,
    parish_work text,
    studies_in_lisbon boolean,
    pt_use text,
    main_mode text,
    belonging_1_5 smallint,
    safety_day_1_5 smallint,
    safety_night_1_5 smallint,
    lived_in_lisbon_past boolean,
    safety_overall_1_5 integer
);


ALTER TABLE public.profiles OWNER TO postgres;

--
-- Name: selections_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.selections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.selections_id_seq OWNER TO postgres;

--
-- Name: selections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.selections_id_seq OWNED BY public.selections.id;


--
-- Name: theme; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.theme (
    id smallint NOT NULL,
    name text NOT NULL
);


ALTER TABLE public.theme OWNER TO postgres;

--
-- Name: themes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.themes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.themes_id_seq OWNER TO postgres;

--
-- Name: themes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.themes_id_seq OWNED BY public.themes.id;


--
-- Name: selections id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.selections ALTER COLUMN id SET DEFAULT nextval('public.selections_id_seq'::regclass);


--
-- Name: themes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.themes ALTER COLUMN id SET DEFAULT nextval('public.themes_id_seq'::regclass);


--
-- Name: landmark_selection landmark_selection_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.landmark_selection
    ADD CONSTRAINT landmark_selection_pkey PRIMARY KEY (id);


--
-- Name: osm_cache.geom osm_cache.geom_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."osm_cache.geom"
    ADD CONSTRAINT "osm_cache.geom_pkey" PRIMARY KEY (osm_id);


--
-- Name: osm_cache osm_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.osm_cache
    ADD CONSTRAINT osm_cache_pkey PRIMARY KEY (osm_id);


--
-- Name: participant_note participant_note_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.participant_note
    ADD CONSTRAINT participant_note_pkey PRIMARY KEY (participant_id);


--
-- Name: participant participant_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.participant
    ADD CONSTRAINT participant_pkey PRIMARY KEY (id);


--
-- Name: participants participants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (participant_id);


--
-- Name: selections selections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.selections
    ADD CONSTRAINT selections_pkey PRIMARY KEY (id);


--
-- Name: theme theme_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.theme
    ADD CONSTRAINT theme_name_key UNIQUE (name);


--
-- Name: theme theme_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.theme
    ADD CONSTRAINT theme_pkey PRIMARY KEY (id);


--
-- Name: themes themes_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.themes
    ADD CONSTRAINT themes_code_key UNIQUE (code);


--
-- Name: themes themes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.themes
    ADD CONSTRAINT themes_pkey PRIMARY KEY (id);


--
-- Name: user_polygons user_polygons_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_polygons
    ADD CONSTRAINT user_polygons_pkey PRIMARY KEY (id);


--
-- Name: landmark_selection landmark_selection_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.landmark_selection
    ADD CONSTRAINT landmark_selection_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participant(id) ON DELETE CASCADE;


--
-- Name: landmark_selection landmark_selection_theme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.landmark_selection
    ADD CONSTRAINT landmark_selection_theme_id_fkey FOREIGN KEY (theme_id) REFERENCES public.theme(id);


--
-- Name: participant_note participant_note_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.participant_note
    ADD CONSTRAINT participant_note_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participant(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: selections selections_osm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.selections
    ADD CONSTRAINT selections_osm_id_fkey FOREIGN KEY (osm_id) REFERENCES public.osm_cache(osm_id);


--
-- Name: selections selections_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.selections
    ADD CONSTRAINT selections_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: selections selections_theme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.selections
    ADD CONSTRAINT selections_theme_id_fkey FOREIGN KEY (theme_id) REFERENCES public.themes(id);


--
-- Name: user_polygons user_polygons_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_polygons
    ADD CONSTRAINT user_polygons_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: user_polygons user_polygons_theme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_polygons
    ADD CONSTRAINT user_polygons_theme_id_fkey FOREIGN KEY (theme_id) REFERENCES public.themes(id) ON DELETE CASCADE;


--
-- Name: landmark_selection landmark insert anon; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "landmark insert anon" ON public.landmark_selection FOR INSERT TO anon WITH CHECK (true);


--
-- Name: landmark_selection; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.landmark_selection ENABLE ROW LEVEL SECURITY;

--
-- Name: participant_note note insert anon; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "note insert anon" ON public.participant_note FOR INSERT TO anon WITH CHECK (true);


--
-- Name: participant; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.participant ENABLE ROW LEVEL SECURITY;

--
-- Name: participant participant insert anon; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "participant insert anon" ON public.participant FOR INSERT TO anon WITH CHECK (true);


--
-- Name: participant_note; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.participant_note ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: TABLE osm_cache; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.osm_cache TO anon;
GRANT ALL ON TABLE public.osm_cache TO authenticated;
GRANT ALL ON TABLE public.osm_cache TO service_role;


--
-- Name: TABLE selections; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.selections TO anon;
GRANT ALL ON TABLE public.selections TO authenticated;
GRANT ALL ON TABLE public.selections TO service_role;


--
-- Name: TABLE themes; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.themes TO anon;
GRANT ALL ON TABLE public.themes TO authenticated;
GRANT ALL ON TABLE public.themes TO service_role;


--
-- Name: TABLE user_polygons; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_polygons TO anon;
GRANT ALL ON TABLE public.user_polygons TO authenticated;
GRANT ALL ON TABLE public.user_polygons TO service_role;


--
-- Name: TABLE v_manual_polygons; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.v_manual_polygons TO anon;
GRANT ALL ON TABLE public.v_manual_polygons TO authenticated;
GRANT ALL ON TABLE public.v_manual_polygons TO service_role;


--
-- Name: TABLE v_osm_polygons; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.v_osm_polygons TO anon;
GRANT ALL ON TABLE public.v_osm_polygons TO authenticated;
GRANT ALL ON TABLE public.v_osm_polygons TO service_role;


--
-- Name: TABLE v_osm_polygons_selected; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.v_osm_polygons_selected TO anon;
GRANT ALL ON TABLE public.v_osm_polygons_selected TO authenticated;
GRANT ALL ON TABLE public.v_osm_polygons_selected TO service_role;


--
-- Name: TABLE v_all_polygons; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.v_all_polygons TO anon;
GRANT ALL ON TABLE public.v_all_polygons TO authenticated;
GRANT ALL ON TABLE public.v_all_polygons TO service_role;


--
-- Name: TABLE landmark_selection; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.landmark_selection TO anon;
GRANT ALL ON TABLE public.landmark_selection TO authenticated;
GRANT ALL ON TABLE public.landmark_selection TO service_role;


--
-- Name: SEQUENCE landmark_selection_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.landmark_selection_id_seq TO anon;
GRANT ALL ON SEQUENCE public.landmark_selection_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.landmark_selection_id_seq TO service_role;


--
-- Name: TABLE "osm_cache.geom"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public."osm_cache.geom" TO anon;
GRANT ALL ON TABLE public."osm_cache.geom" TO authenticated;
GRANT ALL ON TABLE public."osm_cache.geom" TO service_role;


--
-- Name: TABLE participant; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.participant TO anon;
GRANT ALL ON TABLE public.participant TO authenticated;
GRANT ALL ON TABLE public.participant TO service_role;


--
-- Name: TABLE participant_note; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.participant_note TO anon;
GRANT ALL ON TABLE public.participant_note TO authenticated;
GRANT ALL ON TABLE public.participant_note TO service_role;


--
-- Name: TABLE participants; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.participants TO anon;
GRANT ALL ON TABLE public.participants TO authenticated;
GRANT ALL ON TABLE public.participants TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: SEQUENCE selections_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.selections_id_seq TO anon;
GRANT ALL ON SEQUENCE public.selections_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.selections_id_seq TO service_role;


--
-- Name: TABLE theme; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.theme TO anon;
GRANT ALL ON TABLE public.theme TO authenticated;
GRANT ALL ON TABLE public.theme TO service_role;


--
-- Name: SEQUENCE themes_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.themes_id_seq TO anon;
GRANT ALL ON SEQUENCE public.themes_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.themes_id_seq TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

