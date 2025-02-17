from .models import ResearchInfo
import pandas as pd

def run():
    dataset = pd.read_csv("../sampled_dataset.csv")
    for i in range(len(dataset)):
        research = ResearchInfo.objects.create(
            title=dataset.loc[i, "title"],
            category=dataset.loc[i, "category"],
            summary=dataset.loc[i, "summary"],
            authors=dataset.loc[i, "authors"]
        )
        research.save()
    print("Data inserted successfully!")
    
run()
    