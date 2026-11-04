<div align="center">

# JAKPER

**Punto de venta, kardex y gestión de inventario por lotes**
Proyecto acádemico Lucky Pet (clínica veterinaria y tienda)

![Python](https://img.shields.io/badge/Python-3.14-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.162-009688?logo=fastapi&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-3.4-06B6D4?logo=tailwindcss&logoColor=white)
![Pytest](https://img.shields.io/badge/tests-pytest-0A9EDC?logo=pytest&logoColor=white)

![Punto de venta](docs/screenshots/pos.png)

</div>


## Descripción

Sistema para llevar las ventas, compras e inventario de una veterinaria con farmacia, alimentos y accesorios. Cada entrada y salida de mercancía se registra por lote, así que siempre se puede saber qué se vendió, de qué lote salió y quién lo hizo.

- **Punto de venta** con carrito, cobro, ticket y búsqueda rápida tolerante a errores ortográficos.
- **Inventario por lotes** con despacho automático FEFO (perecederos) y FIFO (resto).
- **Kardex inmutable:** el historial no se puede modificar ni borrar, ni siquiera desde la base de datos.
- **Compras, devoluciones, cancelaciones y mermas**, con control de concurrencia para evitar sobreventas.
- **Dashboard** de ventas y **roles** (Admin, Encargado y Cajero) validados en el servidor.

## Capturas

| Punto de venta | Dashboard |
|:---:|:---:|
| ![POS](docs/screenshots/pos.png) | ![Dashboard](docs/screenshots/dashboard.png) |
| **Kardex** | **Compras por lote** |
| ![Kardex](docs/screenshots/kardex.png) | ![Compras](docs/screenshots/compras.png) |

## Modelo de datos

14 tablas. El DDL completo está en [`database/schema.sql`](database/schema.sql).

![Diagrama ER](docs/screenshots/DIAGRAMA.png)

## Instalación

**Requisitos:** Python 3.11+, Node.js 20+ y PostgreSQL 14+ con permiso para `CREATE EXTENSION pg_trgm`.

**1. Clonar e instalar dependencias**

```bash
git clone https://github.com/AngelME14/JAKPER.git
cd JAKPER
python -m venv venv
venv\Scripts\activate          # Linux / macOS: source venv/bin/activate
pip install -r requirements.txt
```

**2. Configurar el entorno**

```bash
cp .env.example .env           # Windows CMD: copy .env.example .env
```

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL, p. ej. `postgresql://postgres:tu_password@localhost:5432/luckypet_db` |
| `SECRET_KEY` | Clave para firmar los JWT (cadena larga y aleatoria) |
| `ACCESS_TOKEN_MINUTES` | Vigencia de la sesión en minutos (480 por defecto) |
| `ADMIN_PASSWORD` | *Opcional.* Contraseña fija para el usuario `admin` |

**3. Crear la base de datos y los datos iniciales**

```bash
createdb -U postgres luckypet_db
psql -U postgres -d luckypet_db -f database/schema.sql

# Datos iniciales (necesita PYTHONPATH=backend)
PYTHONPATH=backend python seed.py                  # Linux / macOS
$env:PYTHONPATH="backend"; python seed.py          # Windows PowerShell
set PYTHONPATH=backend && python seed.py           # Windows CMD
```

El seed se puede correr varias veces sin duplicar datos. Crea el cliente "Público General" (id 1), las categorías base y el usuario `admin`. Si no defines `ADMIN_PASSWORD`, genera una contraseña y **la imprime una sola vez** en consola.

**4. Arrancar el backend** (desde `backend/`)

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

API en `http://localhost:8000`, documentación en `http://localhost:8000/docs`.

**5. Arrancar el frontend**

```bash
cd frontend
npm install
npm run dev
```

Abre `http://localhost:5173` e inicia sesión con `admin`.

## Pruebas

```bash
python -m pytest -v
```

Son pruebas de integración contra un PostgreSQL local real, incluyendo escenarios de concurrencia con hilos. Cada prueba crea y elimina sus propios datos. Usa una base de datos de desarrollo: leen `DATABASE_URL` de tu `.env`.

## Estructura

```
JAKPER/
├── backend/app/
│   ├── api/routers/    # endpoints por módulo
│   ├── core/           # conexión a BD y seguridad
│   ├── models/         # modelos SQLAlchemy
│   ├── schemas/        # validación con Pydantic
│   ├── services/       # lógica de negocio
│   └── main.py
├── database/schema.sql # tablas, triggers e índices
├── frontend/src/       # pages, components, store, hooks
├── tests/              # pruebas de integración
├── docs/screenshots/
└── seed.py
```

## Autor

**Jose Angel Morales Ezquivel** — Estudiante de Ingeniería en Administración de Sistemas, FIME-UANL.
[LinkedIn](https://www.linkedin.com/in/jose-angel-morales-ezquivel) · [GitHub](https://github.com/AngelME14)
