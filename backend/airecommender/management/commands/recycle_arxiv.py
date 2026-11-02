"""
Search the live arXiv API and recycle what it returns into ChromaDB.

This runs the search fallback's own write path, synchronously.  The pipeline
recycles in the background and never reports the outcome to the user, so this
command is how an operator confirms that live papers really land in the
collection on the external Chroma server:

    python manage.py recycle_arxiv "graph neural networks for molecules" --dry-run
    python manage.py recycle_arxiv "graph neural networks for molecules"

Under docker compose:

    docker compose exec backend python manage.py recycle_arxiv "diffusion models"

Exits non-zero when Chroma, arXiv or the write itself fails, so it can gate a
deploy.
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from airecommender.pipeline.chroma import chroma_settings
from airecommender.pipeline.dense_rag import DenseRAG
from airecommender.pipeline.sources.arxiv_api import ArxivClient, ArxivUnavailable
from airecommender.pipeline.sources.recycle import ArxivRecycler, build_records


class Command(BaseCommand):
    help = (
        "Search the live arXiv API and write the papers it returns into the "
        "ChromaDB collection, exactly as the search fallback does."
    )

    def add_arguments(self, parser):
        parser.add_argument("query", help="What to search arXiv for.")
        parser.add_argument(
            "--max-results",
            type=int,
            default=None,
            help="Papers to request (default: ARXIV_FALLBACK_MAX_RESULTS).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Run every check and report what is new, but write nothing.",
        )

    def handle(self, *args, **options):
        dense = DenseRAG()
        recycler = ArxivRecycler(
            collection_fn=lambda: dense.collection,
            embed_fn=dense.embed_documents,
            embedding_model=dense.embedding_model,
            is_ephemeral_fn=chroma_settings.is_ephemeral,
        )

        # Chroma first: no point asking arXiv for papers there is nowhere to put.
        target = f"{settings.CHROMA_HOST}:{settings.CHROMA_PORT}"
        try:
            collection = dense.collection
            before = collection.count()
        except Exception as exc:
            raise CommandError(f"ChromaDB at {target} is not usable: {exc}") from exc
        store = "IN-MEMORY FALLBACK" if chroma_settings.is_ephemeral() else target
        self.stdout.write(
            f"ChromaDB {store} · collection {collection.name!r} · {before} records"
        )

        try:
            candidates = ArxivClient().search(
                options["query"], max_results=options["max_results"]
            )
        except ArxivUnavailable as exc:
            raise CommandError(f"arXiv could not be reached: {exc}") from exc

        records = build_records(candidates)
        self.stdout.write(
            f"arXiv returned {len(candidates)} paper(s); "
            f"{len(records)} with a usable arXiv ID."
        )
        if not records:
            return

        report = recycler.write(records, dry_run=options["dry_run"])
        if report.error:
            raise CommandError(
                f"{report.written} of {len(report.new_ids) or len(records)} "
                f"paper(s) written before the write failed: {report.error}"
            )

        titles = {record.id: record.metadata.get("title", "") for record in records}
        for record_id in report.new_ids:
            self.stdout.write(f"  + {record_id}  {titles.get(record_id, '')}")

        if options["dry_run"]:
            self.stdout.write(
                f"Dry run: {len(report.new_ids)} new, {report.already_present} "
                f"already in the collection. Nothing was written."
            )
            return

        after = collection.count()
        self.stdout.write(
            self.style.SUCCESS(
                f"Wrote {report.written} new paper(s), {report.already_present} "
                f"already present. Collection: {before} → {after} records."
            )
        )
