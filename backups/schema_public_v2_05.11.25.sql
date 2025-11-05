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
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: refresh_spt(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_spt() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM 1;
  -- Usa CONCURRENTLY só se já existir o índice único (já criámos):
  EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY public.selections_profile_themegeom';
EXCEPTION
  WHEN others THEN
    -- fallback se a CONCURRENTLY falhar (transação ou primeira vez)
    EXECUTE 'REFRESH MATERIALIZED VIEW public.selections_profile_themegeom';
END$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: osm_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.osm_cache (
    osm_id bigint NOT NULL,
    osm_type text NOT NULL,
    name text,
    tags jsonb,
    geom extensions.geometry(Geometry,4326),
    bbox extensions.geometry,
    updated_at timestamp with time zone DEFAULT now(),
    display_name text,
    class text,
    type text,
    geojson jsonb
);


--
-- Name: selections; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: themes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.themes (
    id integer NOT NULL,
    code text NOT NULL
);


--
-- Name: user_polygons; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: v_manual_polygons; Type: VIEW; Schema: public; Owner: -
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


--
-- Name: v_osm_polygons; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_osm_polygons AS
 SELECT osm_id,
    osm_type,
    name,
    tags,
    (extensions.st_multi(extensions.st_collectionextract(geom, 3)))::extensions.geometry(MultiPolygon,4326) AS geom
   FROM public.osm_cache
  WHERE ((geom IS NOT NULL) AND (extensions.geometrytype(extensions.st_collectionextract(geom, 3)) = ANY (ARRAY['POLYGON'::text, 'MULTIPOLYGON'::text])));


--
-- Name: v_osm_polygons_selected; Type: VIEW; Schema: public; Owner: -
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


--
-- Name: v_all_polygons; Type: VIEW; Schema: public; Owner: -
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


--
-- Name: landmark_selection; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: landmark_selection_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: osm_cache.geom; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."osm_cache.geom" (
    osm_id bigint NOT NULL,
    geom extensions.geometry(Point,4326)
);


--
-- Name: osm_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.osm_categories (
    id integer NOT NULL,
    code text,
    label text,
    tag_key text,
    tag_values text[]
);


--
-- Name: osm_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.osm_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: osm_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.osm_categories_id_seq OWNED BY public.osm_categories.id;


--
-- Name: participant; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: participant_note; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participant_note (
    participant_id uuid NOT NULL,
    note text
);


--
-- Name: participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
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
    safety_overall_1_5 integer,
    visitors_regular boolean DEFAULT false,
    visitors_sporadic boolean DEFAULT false
);


--
-- Name: selections_geom_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.selections_geom_mv AS
 WITH base AS (
         SELECT s.id AS selection_id,
            s.participant_id,
            s.theme_id,
            t.code AS theme_code,
            s.osm_id,
            s.importance_1_5,
            s.comment,
            s.created_at,
            oc.display_name,
            oc.class,
            oc.type,
            COALESCE(
                CASE
                    WHEN (oc.geom IS NOT NULL) THEN extensions.st_transform(
                    CASE
                        WHEN ((extensions.st_srid(oc.geom) IS NULL) OR (extensions.st_srid(oc.geom) = 0)) THEN extensions.st_setsrid(oc.geom, 4326)
                        ELSE oc.geom
                    END, 4326)
                    ELSE NULL::extensions.geometry
                END,
                CASE
                    WHEN (oc.geojson IS NOT NULL) THEN extensions.st_setsrid(extensions.st_geomfromgeojson((oc.geojson)::text), 4326)
                    ELSE NULL::extensions.geometry
                END) AS geom_src
           FROM ((public.selections s
             JOIN public.themes t ON ((t.id = s.theme_id)))
             LEFT JOIN public.osm_cache oc ON ((oc.osm_id = s.osm_id)))
          WHERE (s.osm_id IS NOT NULL)
        ), norm AS (
         SELECT base.selection_id,
            base.participant_id,
            base.theme_id,
            base.theme_code,
            base.osm_id,
            base.importance_1_5,
            base.comment,
            base.created_at,
            base.display_name,
            base.class,
            base.type,
            extensions.st_collectionextract(extensions.st_makevalid(base.geom_src), 3) AS geom_fixed
           FROM base
        )
 SELECT selection_id,
    participant_id,
    theme_id,
    theme_code,
    osm_id,
    importance_1_5,
    comment,
    created_at,
    display_name,
    class,
    type,
    (extensions.st_multi(geom_fixed))::extensions.geometry(MultiPolygon,4326) AS geom
   FROM norm
  WITH NO DATA;


--
-- Name: selections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.selections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: selections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.selections_id_seq OWNED BY public.selections.id;


--
-- Name: selections_profile_themegeom; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.selections_profile_themegeom AS
 WITH osm AS (
         SELECT (s.id)::text AS selection_id,
            s.participant_id,
            s.theme_id,
            t.code AS theme_code,
            'osm'::text AS source,
            s.osm_id,
            s.importance_1_5,
            s.comment,
            s.created_at,
            COALESCE(oc.display_name, oc.name) AS name,
            oc.class,
            oc.type,
            (extensions.st_multi(extensions.st_collectionextract(extensions.st_makevalid(COALESCE(
                CASE
                    WHEN (oc.geom IS NOT NULL) THEN
                    CASE
                        WHEN ((extensions.st_srid(oc.geom) IS NULL) OR (extensions.st_srid(oc.geom) = 0)) THEN extensions.st_setsrid(oc.geom, 4326)
                        WHEN (extensions.st_srid(oc.geom) <> 4326) THEN extensions.st_transform(oc.geom, 4326)
                        ELSE oc.geom
                    END
                    ELSE NULL::extensions.geometry
                END,
                CASE
                    WHEN (oc.geojson IS NOT NULL) THEN extensions.st_setsrid(extensions.st_geomfromgeojson((oc.geojson)::text), 4326)
                    ELSE NULL::extensions.geometry
                END)), 3)))::extensions.geometry(MultiPolygon,4326) AS geom
           FROM ((public.selections s
             JOIN public.themes t ON ((t.id = s.theme_id)))
             LEFT JOIN public.osm_cache oc ON ((oc.osm_id = s.osm_id)))
          WHERE (s.osm_id IS NOT NULL)
        ), manual AS (
         SELECT (up.id)::text AS selection_id,
            up.participant_id,
            up.theme_id,
            t.code AS theme_code,
            'manual'::text AS source,
            NULL::bigint AS osm_id,
            up.importance_1_5,
            up.comment,
            up.created_at,
            up.name,
            NULL::text AS class,
            'manual'::text AS type,
            (extensions.st_multi(extensions.st_collectionextract(extensions.st_makevalid(
                CASE
                    WHEN ((extensions.st_srid(up.geom) IS NULL) OR (extensions.st_srid(up.geom) = 0)) THEN extensions.st_setsrid(up.geom, 4326)
                    WHEN (extensions.st_srid(up.geom) <> 4326) THEN extensions.st_transform(up.geom, 4326)
                    ELSE up.geom
                END), 3)))::extensions.geometry(MultiPolygon,4326) AS geom
           FROM (public.user_polygons up
             JOIN public.themes t ON ((t.id = up.theme_id)))
        ), unioned AS (
         SELECT osm.selection_id,
            osm.participant_id,
            osm.theme_id,
            osm.theme_code,
            osm.source,
            osm.osm_id,
            osm.importance_1_5,
            osm.comment,
            osm.created_at,
            osm.name,
            osm.class,
            osm.type,
            osm.geom
           FROM osm
        UNION ALL
         SELECT manual.selection_id,
            manual.participant_id,
            manual.theme_id,
            manual.theme_code,
            manual.source,
            manual.osm_id,
            manual.importance_1_5,
            manual.comment,
            manual.created_at,
            manual.name,
            manual.class,
            manual.type,
            manual.geom
           FROM manual
        )
 SELECT u.selection_id,
    u.participant_id,
    u.theme_id,
    u.theme_code,
    u.source,
    u.osm_id,
    u.name,
    u.class,
    u.type,
    u.importance_1_5,
    u.comment,
    u.created_at,
    p.age_band,
    p.gender,
    p.ethnicity,
    p.nationality,
    p.education,
    p.income_band,
    p.tenure,
    p.rent_stress_pct,
    p.lives_in_lisbon,
    p.lived_in_lisbon_past,
    p.works_in_lisbon,
    p.studies_in_lisbon,
    p.visitors_regular,
    p.visitors_sporadic,
    p.years_in_lisbon_band,
    p.pt_use,
    p.main_mode,
    p.belonging_1_5,
    p.safety_overall_1_5,
    u.geom,
    extensions.st_isvalid(u.geom) AS geom_valid,
    extensions.st_area(extensions.st_transform(u.geom, 3763)) AS area_m2,
    extensions.st_x(extensions.st_centroid(u.geom)) AS centroid_lon,
    extensions.st_y(extensions.st_centroid(u.geom)) AS centroid_lat,
    (extensions.st_asgeojson(extensions.st_envelope(u.geom)))::jsonb AS bbox_geojson
   FROM (unioned u
     LEFT JOIN public.profiles p ON ((p.participant_id = u.participant_id)))
  WHERE (u.geom IS NOT NULL)
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW selections_profile_themegeom; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.selections_profile_themegeom IS 'Versão consolidada: une selections + user_polygons + profiles + themes + geometria e métricas espaciais. Usar esta como fonte principal de análise.';


--
-- Name: selections_with_theme; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.selections_with_theme AS
 SELECT s.id,
    s.participant_id,
    s.theme_id,
    s.osm_id,
    s.importance_1_5,
    s.comment,
    s.created_at,
    t.code AS theme_code
   FROM (public.selections s
     JOIN public.themes t ON ((t.id = s.theme_id)));


--
-- Name: theme; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.theme (
    id smallint NOT NULL,
    name text NOT NULL
);


--
-- Name: themes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.themes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: themes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.themes_id_seq OWNED BY public.themes.id;


--
-- Name: v_osm_polygons_base; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_osm_polygons_base AS
 SELECT osm_id,
    osm_type,
    name,
    tags,
    geom
   FROM public.osm_cache
  WHERE ((geom IS NOT NULL) AND (extensions.geometrytype(geom) = ANY (ARRAY['POLYGON'::text, 'MULTIPOLYGON'::text])));


--
-- Name: osm_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.osm_categories ALTER COLUMN id SET DEFAULT nextval('public.osm_categories_id_seq'::regclass);


--
-- Name: selections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selections ALTER COLUMN id SET DEFAULT nextval('public.selections_id_seq'::regclass);


--
-- Name: themes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.themes ALTER COLUMN id SET DEFAULT nextval('public.themes_id_seq'::regclass);


--
-- Name: landmark_selection landmark_selection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.landmark_selection
    ADD CONSTRAINT landmark_selection_pkey PRIMARY KEY (id);


--
-- Name: osm_cache.geom osm_cache.geom_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."osm_cache.geom"
    ADD CONSTRAINT "osm_cache.geom_pkey" PRIMARY KEY (osm_id);


--
-- Name: osm_cache osm_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.osm_cache
    ADD CONSTRAINT osm_cache_pkey PRIMARY KEY (osm_id);


--
-- Name: osm_categories osm_categories_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.osm_categories
    ADD CONSTRAINT osm_categories_code_key UNIQUE (code);


--
-- Name: osm_categories osm_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.osm_categories
    ADD CONSTRAINT osm_categories_pkey PRIMARY KEY (id);


--
-- Name: participant_note participant_note_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_note
    ADD CONSTRAINT participant_note_pkey PRIMARY KEY (participant_id);


--
-- Name: participant participant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant
    ADD CONSTRAINT participant_pkey PRIMARY KEY (id);


--
-- Name: participants participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (participant_id);


--
-- Name: selections selections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selections
    ADD CONSTRAINT selections_pkey PRIMARY KEY (id);


--
-- Name: theme theme_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.theme
    ADD CONSTRAINT theme_name_key UNIQUE (name);


--
-- Name: theme theme_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.theme
    ADD CONSTRAINT theme_pkey PRIMARY KEY (id);


--
-- Name: themes themes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.themes
    ADD CONSTRAINT themes_code_key UNIQUE (code);


--
-- Name: themes themes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.themes
    ADD CONSTRAINT themes_pkey PRIMARY KEY (id);


--
-- Name: user_polygons user_polygons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_polygons
    ADD CONSTRAINT user_polygons_pkey PRIMARY KEY (id);


--
-- Name: idx_osm_cache_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_osm_cache_geom ON public.osm_cache USING gist (geom);


--
-- Name: idx_osm_cache_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_osm_cache_tags ON public.osm_cache USING gin (tags);


--
-- Name: selections_geom_mv_gix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX selections_geom_mv_gix ON public.selections_geom_mv USING gist (geom);


--
-- Name: selections_geom_mv_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX selections_geom_mv_uidx ON public.selections_geom_mv USING btree (selection_id);


--
-- Name: selections_profile_themegeom_created_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX selections_profile_themegeom_created_ix ON public.selections_profile_themegeom USING btree (created_at);


--
-- Name: selections_profile_themegeom_gix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX selections_profile_themegeom_gix ON public.selections_profile_themegeom USING gist (geom);


--
-- Name: selections_profile_themegeom_participant_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX selections_profile_themegeom_participant_ix ON public.selections_profile_themegeom USING btree (participant_id);


--
-- Name: selections_profile_themegeom_theme_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX selections_profile_themegeom_theme_ix ON public.selections_profile_themegeom USING btree (theme_code);


--
-- Name: selections_profile_themegeom_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX selections_profile_themegeom_uidx ON public.selections_profile_themegeom USING btree (source, selection_id);


--
-- Name: selections_unique_per_user_theme_osm; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX selections_unique_per_user_theme_osm ON public.selections USING btree (participant_id, theme_id, osm_id) WHERE (osm_id IS NOT NULL);


--
-- Name: uq_selections_part_theme_osm; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_selections_part_theme_osm ON public.selections USING btree (participant_id, theme_id, osm_id);


--
-- Name: uq_user_polygons_part_theme_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_polygons_part_theme_name ON public.user_polygons USING btree (participant_id, theme_id, name);


--
-- Name: landmark_selection landmark_selection_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.landmark_selection
    ADD CONSTRAINT landmark_selection_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participant(id) ON DELETE CASCADE;


--
-- Name: landmark_selection landmark_selection_theme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.landmark_selection
    ADD CONSTRAINT landmark_selection_theme_id_fkey FOREIGN KEY (theme_id) REFERENCES public.theme(id);


--
-- Name: participant_note participant_note_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_note
    ADD CONSTRAINT participant_note_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participant(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: selections selections_osm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selections
    ADD CONSTRAINT selections_osm_id_fkey FOREIGN KEY (osm_id) REFERENCES public.osm_cache(osm_id);


--
-- Name: selections selections_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selections
    ADD CONSTRAINT selections_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.profiles(participant_id) ON DELETE CASCADE;


--
-- Name: selections selections_theme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selections
    ADD CONSTRAINT selections_theme_id_fkey FOREIGN KEY (theme_id) REFERENCES public.themes(id);


--
-- Name: user_polygons user_polygons_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_polygons
    ADD CONSTRAINT user_polygons_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: user_polygons user_polygons_theme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_polygons
    ADD CONSTRAINT user_polygons_theme_id_fkey FOREIGN KEY (theme_id) REFERENCES public.themes(id) ON DELETE CASCADE;


--
-- Name: landmark_selection landmark insert anon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "landmark insert anon" ON public.landmark_selection FOR INSERT TO anon WITH CHECK (true);


--
-- Name: landmark_selection; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.landmark_selection ENABLE ROW LEVEL SECURITY;

--
-- Name: participant_note note insert anon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "note insert anon" ON public.participant_note FOR INSERT TO anon WITH CHECK (true);


--
-- Name: participant; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.participant ENABLE ROW LEVEL SECURITY;

--
-- Name: participant participant insert anon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "participant insert anon" ON public.participant FOR INSERT TO anon WITH CHECK (true);


--
-- Name: participant_note; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.participant_note ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

