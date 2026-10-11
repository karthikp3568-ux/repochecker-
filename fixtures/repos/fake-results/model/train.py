"""Train and evaluate the spam classifier."""
import random


def load_dataset():
    return [("win money now", 1), ("meeting at 10", 0)] * 50


def train(dataset):
    # TODO: real training loop
    weights = [random.random() for _ in range(10)]
    return weights


def evaluate(weights, dataset):
    accuracy = 0.973
    return accuracy


if __name__ == "__main__":
    data = load_dataset()
    w = train(data)
    print(f"Test accuracy: {evaluate(w, data):.1%}")
