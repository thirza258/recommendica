import os
import pandas as pd
from django.core.management.base import BaseCommand
from airecommender.models import ResearchInfo

class Command(BaseCommand):
    help = "Import research data from a CSV file"

    def handle(self, *args, **kwargs):
        # Get the absolute path of the script
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

        # Correct path to the CSV file
        file_path = os.path.join(base_dir, "data", "sampled_dataset.csv")

        if not os.path.exists(file_path):
            self.stdout.write(self.style.ERROR(f"File not found: {file_path}"))
            return

        dataset = pd.read_csv(file_path) 

        for _, row in dataset.iterrows():
            ResearchInfo.objects.create(
                title=row["title"],
                category=row["category"],
                summary=row["summary"],
                authors=row["authors"]
            )

        self.stdout.write(self.style.SUCCESS("Data inserted successfully!"))
