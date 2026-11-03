-- =====================================================================
-- LuckyPet (JAKPER) - esquema PostgreSQL (fuente de verdad del DDL)
--
-- Uso en una base vacia (PostgreSQL 14+; desarrollado sobre 18):
--   createdb -U postgres luckypet_db
--   psql -U postgres -d luckypet_db -f database/schema.sql
--   python seed.py            -- usuario admin, Publico General, categorias
--
-- Requiere privilegios para CREATE EXTENSION pg_trgm (contrib).
-- No es idempotente: crea tablas, funciones y triggers desde cero.
-- Todo cambio de esquema se hace aqui; el backend ya no ejecuta DDL al arrancar.
-- =====================================================================

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: fn_validar_caducidad_obligatoria(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validar_caducidad_obligatoria() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_requiere BOOLEAN;
BEGIN
    SELECT requiere_caducidad INTO v_requiere FROM productos WHERE id = NEW.producto_id;
    IF v_requiere = TRUE AND NEW.fecha_caducidad IS NULL THEN
        RAISE EXCEPTION 'El producto % requiere obligatoriamente una fecha de caducidad.', NEW.producto_id;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: fn_validar_limite_devolucion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validar_limite_devolucion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_cantidad_vendida NUMERIC;
    v_total_devuelto NUMERIC;
BEGIN
    SELECT cantidad INTO v_cantidad_vendida
    FROM detalle_ventas
    WHERE id = NEW.detalle_venta_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El detalle de venta % no existe.', NEW.detalle_venta_id;
    END IF;

    SELECT COALESCE(SUM(cantidad), 0) INTO v_total_devuelto
    FROM devoluciones
    WHERE detalle_venta_id = NEW.detalle_venta_id
      AND id <> COALESCE(NEW.id, -1);

    IF (v_total_devuelto + NEW.cantidad) > v_cantidad_vendida THEN
        RAISE EXCEPTION 'Rechazado: Cantidad a devolver (%) + devoluciones previas (%) supera lo vendido (%).',
            NEW.cantidad, v_total_devuelto, v_cantidad_vendida;
    END IF;

    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: categorias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categorias (
    id bigint NOT NULL,
    nombre character varying(80) NOT NULL,
    creado_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: categorias_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.categorias ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.categorias_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: clientes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clientes (
    id bigint NOT NULL,
    nombre character varying(150) NOT NULL,
    telefono character varying(20),
    correo character varying(120),
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: clientes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.clientes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.clientes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: compras; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compras (
    id bigint NOT NULL,
    folio character varying(30) NOT NULL,
    proveedor_id bigint NOT NULL,
    usuario_id bigint NOT NULL,
    estado character varying(20) DEFAULT 'RECIBIDA'::character varying NOT NULL,
    total numeric(12,2) NOT NULL,
    fecha_compra timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    factura_proveedor character varying(60) DEFAULT NULL::character varying,
    CONSTRAINT compras_estado_check CHECK (((estado)::text = ANY ((ARRAY['RECIBIDA'::character varying, 'CANCELADA'::character varying])::text[]))),
    CONSTRAINT compras_total_check CHECK ((total >= (0)::numeric))
);


--
-- Name: compras_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.compras ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.compras_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: detalle_compras; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detalle_compras (
    id bigint NOT NULL,
    compra_id bigint NOT NULL,
    producto_id bigint NOT NULL,
    lote_id bigint NOT NULL,
    cantidad numeric(10,3) NOT NULL,
    costo_unitario numeric(12,2) NOT NULL,
    subtotal numeric(12,2) NOT NULL,
    CONSTRAINT detalle_compras_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT detalle_compras_costo_unitario_check CHECK ((costo_unitario >= (0)::numeric)),
    CONSTRAINT detalle_compras_subtotal_check CHECK ((subtotal >= (0)::numeric))
);


--
-- Name: detalle_compras_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.detalle_compras ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.detalle_compras_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: detalle_ventas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detalle_ventas (
    id bigint NOT NULL,
    venta_id bigint NOT NULL,
    producto_id bigint NOT NULL,
    lote_id bigint NOT NULL,
    cantidad numeric(10,3) NOT NULL,
    precio_unitario_aplicado numeric(12,2) NOT NULL,
    costo_unitario_aplicado numeric(12,2) NOT NULL,
    subtotal numeric(12,2) NOT NULL,
    CONSTRAINT detalle_ventas_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT detalle_ventas_costo_unitario_aplicado_check CHECK ((costo_unitario_aplicado >= (0)::numeric)),
    CONSTRAINT detalle_ventas_precio_unitario_aplicado_check CHECK ((precio_unitario_aplicado >= (0)::numeric)),
    CONSTRAINT detalle_ventas_subtotal_check CHECK ((subtotal >= (0)::numeric))
);


--
-- Name: detalle_ventas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.detalle_ventas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.detalle_ventas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: devoluciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devoluciones (
    id bigint NOT NULL,
    venta_id bigint NOT NULL,
    detalle_venta_id bigint NOT NULL,
    cantidad numeric(10,3) NOT NULL,
    motivo text NOT NULL,
    reingreso_a_stock boolean DEFAULT false NOT NULL,
    usuario_id bigint NOT NULL,
    fecha timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT devoluciones_cantidad_check CHECK ((cantidad > (0)::numeric))
);


--
-- Name: devoluciones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.devoluciones ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.devoluciones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: lotes_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lotes_stock (
    id bigint NOT NULL,
    producto_id bigint NOT NULL,
    codigo_lote character varying(80) NOT NULL,
    fecha_recepcion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_caducidad date,
    costo_unitario numeric(12,2) NOT NULL,
    cantidad_disponible numeric(10,3) DEFAULT 0 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_lotes_stock_cantidad_positiva CHECK ((cantidad_disponible >= (0)::numeric)),
    CONSTRAINT lotes_stock_costo_unitario_check CHECK ((costo_unitario >= (0)::numeric))
);


--
-- Name: lotes_stock_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.lotes_stock ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.lotes_stock_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: mermas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mermas (
    id bigint NOT NULL,
    producto_id bigint NOT NULL,
    lote_id bigint NOT NULL,
    cantidad numeric(10,3) NOT NULL,
    costo_unitario_perdida numeric(12,2) NOT NULL,
    motivo character varying(30) NOT NULL,
    descripcion text,
    usuario_id bigint NOT NULL,
    fecha timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT mermas_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT mermas_costo_unitario_perdida_check CHECK ((costo_unitario_perdida >= (0)::numeric)),
    CONSTRAINT mermas_motivo_check CHECK (((motivo)::text = ANY ((ARRAY['CADUCIDAD'::character varying, 'ROTURA_DAÑO'::character varying, 'CONSUMO_INTERNO_TIENDA'::character varying, 'DEVOLUCION_DEFECTUOSA'::character varying])::text[])))
);


--
-- Name: mermas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.mermas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.mermas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: movimientos_inventario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movimientos_inventario (
    id bigint NOT NULL,
    producto_id bigint NOT NULL,
    lote_id bigint NOT NULL,
    tipo character varying(30) NOT NULL,
    cantidad numeric(10,3) NOT NULL,
    usuario_id bigint NOT NULL,
    motivo text,
    detalle_compra_id bigint,
    detalle_venta_id bigint,
    merma_id bigint,
    devolucion_id bigint,
    fecha timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    saldo_resultante numeric(10,3) DEFAULT 0 NOT NULL,
    CONSTRAINT chk_movimiento_origen CHECK (((((tipo)::text = 'ENTRADA_COMPRA'::text) AND (detalle_compra_id IS NOT NULL) AND (detalle_venta_id IS NULL) AND (merma_id IS NULL) AND (devolucion_id IS NULL)) OR (((tipo)::text = ANY ((ARRAY['VENTA'::character varying, 'CANCELACION_VENTA'::character varying])::text[])) AND (detalle_venta_id IS NOT NULL) AND (detalle_compra_id IS NULL) AND (merma_id IS NULL) AND (devolucion_id IS NULL)) OR (((tipo)::text = 'MERMA'::text) AND (merma_id IS NOT NULL) AND (detalle_compra_id IS NULL) AND (detalle_venta_id IS NULL) AND (devolucion_id IS NULL)) OR (((tipo)::text = 'DEVOLUCION_STOCK'::text) AND (devolucion_id IS NOT NULL) AND (detalle_compra_id IS NULL) AND (detalle_venta_id IS NULL) AND (merma_id IS NULL)) OR (((tipo)::text = ANY ((ARRAY['AJUSTE_ENTRADA'::character varying, 'AJUSTE_SALIDA'::character varying])::text[])) AND (motivo IS NOT NULL) AND (detalle_compra_id IS NULL) AND (detalle_venta_id IS NULL) AND (merma_id IS NULL) AND (devolucion_id IS NULL)))),
    CONSTRAINT movimientos_inventario_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT movimientos_inventario_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['ENTRADA_COMPRA'::character varying, 'VENTA'::character varying, 'CANCELACION_VENTA'::character varying, 'MERMA'::character varying, 'DEVOLUCION_STOCK'::character varying, 'AJUSTE_ENTRADA'::character varying, 'AJUSTE_SALIDA'::character varying])::text[])))
);


--
-- Name: movimientos_inventario_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.movimientos_inventario ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.movimientos_inventario_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pagos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pagos (
    id bigint NOT NULL,
    venta_id bigint NOT NULL,
    metodo character varying(20) NOT NULL,
    importe numeric(12,2) NOT NULL,
    pago_con numeric(12,2),
    cambio numeric(12,2) DEFAULT 0,
    fecha_pago timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    referencia character varying(80),
    CONSTRAINT pagos_cambio_check CHECK ((cambio >= (0)::numeric)),
    CONSTRAINT pagos_check CHECK ((pago_con >= importe)),
    CONSTRAINT pagos_importe_check CHECK ((importe > (0)::numeric)),
    CONSTRAINT pagos_metodo_check CHECK (((metodo)::text = ANY ((ARRAY['EFECTIVO'::character varying, 'TARJETA'::character varying, 'TRANSFERENCIA'::character varying])::text[])))
);


--
-- Name: pagos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pagos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pagos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: productos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.productos (
    id bigint NOT NULL,
    categoria_id bigint NOT NULL,
    codigo_barras_sku character varying(60),
    nombre character varying(150) NOT NULL,
    precio_venta numeric(12,2) NOT NULL,
    stock_minimo numeric(10,3) DEFAULT 0 NOT NULL,
    permite_decimales boolean DEFAULT false NOT NULL,
    requiere_caducidad boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    imagen_url character varying(255) DEFAULT NULL::character varying,
    unidad_medida character varying(20) DEFAULT 'PZA'::character varying NOT NULL,
    CONSTRAINT productos_precio_venta_check CHECK ((precio_venta >= (0)::numeric)),
    CONSTRAINT productos_stock_minimo_check CHECK ((stock_minimo >= (0)::numeric))
);


--
-- Name: productos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.productos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.productos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: proveedores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proveedores (
    id bigint NOT NULL,
    razon_social character varying(150) NOT NULL,
    rfc character varying(15),
    telefono character varying(20),
    correo character varying(120),
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: proveedores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.proveedores ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.proveedores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    id bigint NOT NULL,
    nombre character varying(120) NOT NULL,
    usuario character varying(50) NOT NULL,
    password_hash character varying(255) NOT NULL,
    rol character varying(20) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT usuarios_rol_check CHECK (((rol)::text = ANY ((ARRAY['Admin'::character varying, 'Encargado'::character varying, 'Cajero'::character varying])::text[])))
);


--
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.usuarios ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.usuarios_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ventas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ventas (
    id bigint NOT NULL,
    folio character varying(30) NOT NULL,
    cliente_id bigint NOT NULL,
    usuario_id bigint NOT NULL,
    subtotal numeric(12,2) NOT NULL,
    total numeric(12,2) NOT NULL,
    estado character varying(20) DEFAULT 'COMPLETADA'::character varying NOT NULL,
    motivo_cancelacion text,
    fecha_venta timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_ventas_cancelacion_motivo CHECK ((((estado)::text = 'COMPLETADA'::text) OR (((estado)::text = 'CANCELADA'::text) AND (motivo_cancelacion IS NOT NULL)))),
    CONSTRAINT ventas_estado_check CHECK (((estado)::text = ANY ((ARRAY['COMPLETADA'::character varying, 'CANCELADA'::character varying])::text[]))),
    CONSTRAINT ventas_subtotal_check CHECK ((subtotal >= (0)::numeric)),
    CONSTRAINT ventas_total_check CHECK ((total >= (0)::numeric))
);


--
-- Name: ventas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ventas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ventas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: categorias categorias_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_nombre_key UNIQUE (nombre);


--
-- Name: categorias categorias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_pkey PRIMARY KEY (id);


--
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);


--
-- Name: compras compras_folio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_folio_key UNIQUE (folio);


--
-- Name: compras compras_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_pkey PRIMARY KEY (id);


--
-- Name: detalle_compras detalle_compras_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compras
    ADD CONSTRAINT detalle_compras_pkey PRIMARY KEY (id);


--
-- Name: detalle_ventas detalle_ventas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_ventas
    ADD CONSTRAINT detalle_ventas_pkey PRIMARY KEY (id);


--
-- Name: devoluciones devoluciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devoluciones
    ADD CONSTRAINT devoluciones_pkey PRIMARY KEY (id);


--
-- Name: lotes_stock lotes_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_stock
    ADD CONSTRAINT lotes_stock_pkey PRIMARY KEY (id);


--
-- Name: mermas mermas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mermas
    ADD CONSTRAINT mermas_pkey PRIMARY KEY (id);


--
-- Name: movimientos_inventario movimientos_inventario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos_inventario
    ADD CONSTRAINT movimientos_inventario_pkey PRIMARY KEY (id);


--
-- Name: pagos pagos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_pkey PRIMARY KEY (id);


--
-- Name: productos productos_codigo_barras_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_codigo_barras_sku_key UNIQUE (codigo_barras_sku);


--
-- Name: productos productos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_pkey PRIMARY KEY (id);


--
-- Name: proveedores proveedores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_pkey PRIMARY KEY (id);


--
-- Name: detalle_compras uq_detalle_compras_id_compra; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compras
    ADD CONSTRAINT uq_detalle_compras_id_compra UNIQUE (id, compra_id);


--
-- Name: detalle_ventas uq_detalle_ventas_id_venta; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_ventas
    ADD CONSTRAINT uq_detalle_ventas_id_venta UNIQUE (id, venta_id);


--
-- Name: lotes_stock uq_lotes_stock_id_producto; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_stock
    ADD CONSTRAINT uq_lotes_stock_id_producto UNIQUE (id, producto_id);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_usuario_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_usuario_key UNIQUE (usuario);


--
-- Name: ventas ventas_folio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ventas
    ADD CONSTRAINT ventas_folio_key UNIQUE (folio);


--
-- Name: ventas ventas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ventas
    ADD CONSTRAINT ventas_pkey PRIMARY KEY (id);


--
-- Name: idx_compras_proveedor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compras_proveedor_id ON public.compras USING btree (proveedor_id);


--
-- Name: idx_detalle_compras_compra_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_compras_compra_id ON public.detalle_compras USING btree (compra_id);


--
-- Name: idx_detalle_ventas_lote_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_ventas_lote_id ON public.detalle_ventas USING btree (lote_id);


--
-- Name: idx_detalle_ventas_producto_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_ventas_producto_id ON public.detalle_ventas USING btree (producto_id);


--
-- Name: idx_detalle_ventas_venta_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_ventas_venta_id ON public.detalle_ventas USING btree (venta_id);


--
-- Name: idx_devoluciones_detalle_venta_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_devoluciones_detalle_venta_id ON public.devoluciones USING btree (detalle_venta_id);


--
-- Name: idx_devoluciones_venta_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_devoluciones_venta_id ON public.devoluciones USING btree (venta_id);


--
-- Name: idx_lotes_fefo_fifo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lotes_fefo_fifo ON public.lotes_stock USING btree (producto_id, fecha_caducidad, fecha_recepcion) WHERE ((activo = true) AND (cantidad_disponible > (0)::numeric));


--
-- Name: idx_lotes_producto_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lotes_producto_id ON public.lotes_stock USING btree (producto_id);


--
-- Name: idx_mermas_lote_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mermas_lote_id ON public.mermas USING btree (lote_id);


--
-- Name: idx_movimientos_detalle_compra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_movimientos_detalle_compra ON public.movimientos_inventario USING btree (detalle_compra_id) WHERE (detalle_compra_id IS NOT NULL);


--
-- Name: idx_movimientos_detalle_venta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_movimientos_detalle_venta ON public.movimientos_inventario USING btree (detalle_venta_id) WHERE (detalle_venta_id IS NOT NULL);


--
-- Name: idx_movimientos_devolucion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_movimientos_devolucion ON public.movimientos_inventario USING btree (devolucion_id) WHERE (devolucion_id IS NOT NULL);


--
-- Name: idx_movimientos_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_movimientos_fecha ON public.movimientos_inventario USING btree (fecha DESC);


--
-- Name: idx_movimientos_merma; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_movimientos_merma ON public.movimientos_inventario USING btree (merma_id) WHERE (merma_id IS NOT NULL);


--
-- Name: idx_movimientos_producto_lote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_movimientos_producto_lote ON public.movimientos_inventario USING btree (producto_id, lote_id);


--
-- Name: idx_movimientos_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_movimientos_tipo ON public.movimientos_inventario USING btree (tipo);


--
-- Name: idx_pagos_venta_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagos_venta_id ON public.pagos USING btree (venta_id);


--
-- Name: idx_productos_categoria_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_productos_categoria_id ON public.productos USING btree (categoria_id);


--
-- Name: idx_productos_nombre_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_productos_nombre_trgm ON public.productos USING gin (nombre public.gin_trgm_ops);


--
-- Name: idx_ventas_cliente_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ventas_cliente_id ON public.ventas USING btree (cliente_id);


--
-- Name: idx_ventas_usuario_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ventas_usuario_id ON public.ventas USING btree (usuario_id);


--
-- Name: lotes_stock trg_validar_caducidad_lote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validar_caducidad_lote BEFORE INSERT OR UPDATE ON public.lotes_stock FOR EACH ROW EXECUTE FUNCTION public.fn_validar_caducidad_obligatoria();


--
-- Name: devoluciones trg_verificar_devolucion_acumulada; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_verificar_devolucion_acumulada BEFORE INSERT OR UPDATE ON public.devoluciones FOR EACH ROW EXECUTE FUNCTION public.fn_validar_limite_devolucion();


--
-- Name: compras compras_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id) ON DELETE RESTRICT;


--
-- Name: compras compras_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: detalle_compras detalle_compras_compra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compras
    ADD CONSTRAINT detalle_compras_compra_id_fkey FOREIGN KEY (compra_id) REFERENCES public.compras(id) ON DELETE RESTRICT;


--
-- Name: detalle_compras detalle_compras_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compras
    ADD CONSTRAINT detalle_compras_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes_stock(id) ON DELETE RESTRICT;


--
-- Name: detalle_compras detalle_compras_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compras
    ADD CONSTRAINT detalle_compras_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE RESTRICT;


--
-- Name: detalle_ventas detalle_ventas_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_ventas
    ADD CONSTRAINT detalle_ventas_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes_stock(id) ON DELETE RESTRICT;


--
-- Name: detalle_ventas detalle_ventas_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_ventas
    ADD CONSTRAINT detalle_ventas_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE RESTRICT;


--
-- Name: detalle_ventas detalle_ventas_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_ventas
    ADD CONSTRAINT detalle_ventas_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.ventas(id) ON DELETE RESTRICT;


--
-- Name: devoluciones devoluciones_detalle_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devoluciones
    ADD CONSTRAINT devoluciones_detalle_venta_id_fkey FOREIGN KEY (detalle_venta_id) REFERENCES public.detalle_ventas(id) ON DELETE RESTRICT;


--
-- Name: devoluciones devoluciones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devoluciones
    ADD CONSTRAINT devoluciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: devoluciones devoluciones_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devoluciones
    ADD CONSTRAINT devoluciones_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.ventas(id) ON DELETE RESTRICT;


--
-- Name: detalle_compras fk_detalle_compras_lote_producto; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compras
    ADD CONSTRAINT fk_detalle_compras_lote_producto FOREIGN KEY (lote_id, producto_id) REFERENCES public.lotes_stock(id, producto_id);


--
-- Name: detalle_ventas fk_detalle_ventas_lote_producto; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_ventas
    ADD CONSTRAINT fk_detalle_ventas_lote_producto FOREIGN KEY (lote_id, producto_id) REFERENCES public.lotes_stock(id, producto_id);


--
-- Name: devoluciones fk_devoluciones_detalle_venta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devoluciones
    ADD CONSTRAINT fk_devoluciones_detalle_venta FOREIGN KEY (detalle_venta_id, venta_id) REFERENCES public.detalle_ventas(id, venta_id);


--
-- Name: mermas fk_mermas_lote_producto; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mermas
    ADD CONSTRAINT fk_mermas_lote_producto FOREIGN KEY (lote_id, producto_id) REFERENCES public.lotes_stock(id, producto_id);


--
-- Name: movimientos_inventario fk_movimientos_lote_producto; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos_inventario
    ADD CONSTRAINT fk_movimientos_lote_producto FOREIGN KEY (lote_id, producto_id) REFERENCES public.lotes_stock(id, producto_id);


--
-- Name: lotes_stock lotes_stock_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_stock
    ADD CONSTRAINT lotes_stock_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE RESTRICT;


--
-- Name: mermas mermas_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mermas
    ADD CONSTRAINT mermas_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes_stock(id) ON DELETE RESTRICT;


--
-- Name: mermas mermas_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mermas
    ADD CONSTRAINT mermas_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE RESTRICT;


--
-- Name: mermas mermas_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mermas
    ADD CONSTRAINT mermas_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: movimientos_inventario movimientos_inventario_detalle_compra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos_inventario
    ADD CONSTRAINT movimientos_inventario_detalle_compra_id_fkey FOREIGN KEY (detalle_compra_id) REFERENCES public.detalle_compras(id) ON DELETE RESTRICT;


--
-- Name: movimientos_inventario movimientos_inventario_detalle_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos_inventario
    ADD CONSTRAINT movimientos_inventario_detalle_venta_id_fkey FOREIGN KEY (detalle_venta_id) REFERENCES public.detalle_ventas(id) ON DELETE RESTRICT;


--
-- Name: movimientos_inventario movimientos_inventario_devolucion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos_inventario
    ADD CONSTRAINT movimientos_inventario_devolucion_id_fkey FOREIGN KEY (devolucion_id) REFERENCES public.devoluciones(id) ON DELETE RESTRICT;


--
-- Name: movimientos_inventario movimientos_inventario_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos_inventario
    ADD CONSTRAINT movimientos_inventario_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes_stock(id) ON DELETE RESTRICT;


--
-- Name: movimientos_inventario movimientos_inventario_merma_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos_inventario
    ADD CONSTRAINT movimientos_inventario_merma_id_fkey FOREIGN KEY (merma_id) REFERENCES public.mermas(id) ON DELETE RESTRICT;


--
-- Name: movimientos_inventario movimientos_inventario_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos_inventario
    ADD CONSTRAINT movimientos_inventario_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE RESTRICT;


--
-- Name: movimientos_inventario movimientos_inventario_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos_inventario
    ADD CONSTRAINT movimientos_inventario_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: pagos pagos_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.ventas(id) ON DELETE RESTRICT;


--
-- Name: productos productos_categoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES public.categorias(id) ON DELETE RESTRICT;


--
-- Name: ventas ventas_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ventas
    ADD CONSTRAINT ventas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE RESTRICT;


--
-- Name: ventas ventas_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ventas
    ADD CONSTRAINT ventas_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


-- =====================================================================
-- Kardex inmutable a nivel de motor
--
-- movimientos_inventario es un libro append-only: solo INSERT. Se rechaza
-- cualquier UPDATE, DELETE o TRUNCATE, sin importar el rol ni la ruta
-- (aplicacion, psql, cascadas de FK). Los triggers de sentencia disparan
-- aunque la sentencia afecte 0 filas.
-- Una correccion se registra como un movimiento nuevo (AJUSTE_*, MERMA,
-- CANCELACION_VENTA, DEVOLUCION_STOCK), nunca editando el historial.
--
-- Limite: un superusuario o el dueño de la tabla aun puede hacer
-- ALTER TABLE ... DISABLE TRIGGER o SET session_replication_role = replica.
-- Para blindarlo del todo, la app debe conectarse con un rol sin esos
-- privilegios.
-- =====================================================================

CREATE FUNCTION public.fn_bloquear_modificacion_kardex() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'El Kardex es inmutable: % sobre movimientos_inventario no esta permitido. Registre un movimiento de ajuste.', TG_OP
        USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER trg_kardex_inmutable_upd_del
    BEFORE UPDATE OR DELETE ON public.movimientos_inventario
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_bloquear_modificacion_kardex();

CREATE TRIGGER trg_kardex_inmutable_truncate
    BEFORE TRUNCATE ON public.movimientos_inventario
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_bloquear_modificacion_kardex();
