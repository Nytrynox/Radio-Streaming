// ============================================================================
// ML MOTION CLASSIFICATION
// Uses TensorFlow.js for real-time motion classification from sensor data
// ============================================================================

import * as tf from '@tensorflow/tfjs';
import type { MLPrediction, MotionClass, MLModelState } from './types';
import { addTrainingData, getTrainingData, clearTrainingData } from './db';

export class MotionClassifier {
  private model: tf.Sequential | null = null;
  private isLoaded = false;
  private isTraining = false;
  private lastPrediction: MLPrediction | null = null;
  private featureHistory: number[][] = [];
  private readonly featureWindowSize = 20;
  private readonly numFeatures = 12; // Number of input features

  private readonly classes: MotionClass[] = [
    'idle',
    'walking',
    'running',
    'standing',
    'multiple_people',
    'approaching',
    'departing',
    'unknown',
  ];

  public async initialize() {
    if (this.model) return;

    try {
      // Try to load saved model
      const savedModel = await tf.loadLayersModel('indexeddb://motion-classifier');
      this.model = savedModel as tf.Sequential;
      this.isLoaded = true;
      console.log('Loaded saved motion classifier model');
    } catch {
      // Create new model
      this.createModel();
      console.log('Created new motion classifier model');
    }
  }

  private createModel() {
    this.model = tf.sequential({
      layers: [
        tf.layers.dense({ 
          inputShape: [this.numFeatures], 
          units: 64, 
          activation: 'relu',
          kernelInitializer: 'glorotNormal'
        }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({ units: 32, activation: 'relu' }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({ units: this.classes.length, activation: 'softmax' }),
      ],
    });

    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy'],
    });

    this.isLoaded = true;
  }

  public extractFeatures(data: {
    wifiIntensity: number;
    wifiNetworks: number;
    wifiMovement: boolean;
    rssiDelta: number;
    bluetoothDevices: number;
    bluetoothNearby: number;
    sonarMovement: number;
    sonarDistance: number;
    lightLevel: number;
    lightShadow: boolean;
    networkActive: number;
    timeSinceLastEvent: number;
  }): number[] {
    return [
      data.wifiIntensity,
      data.wifiNetworks / 20, // Normalize
      data.wifiMovement ? 1 : 0,
      Math.min(1, Math.abs(data.rssiDelta) / 10),
      data.bluetoothDevices / 10,
      data.bluetoothNearby / 5,
      data.sonarMovement,
      Math.min(1, data.sonarDistance / 10),
      data.lightLevel / 1000, // Normalize lux
      data.lightShadow ? 1 : 0,
      data.networkActive / 20,
      Math.min(1, data.timeSinceLastEvent / 60000), // Normalize to 1 minute
    ];
  }

  public async predict(features: number[]): Promise<MLPrediction> {
    if (!this.model || !this.isLoaded) {
      await this.initialize();
    }

    // Add to history for temporal features
    this.featureHistory.push(features);
    if (this.featureHistory.length > this.featureWindowSize) {
      this.featureHistory.shift();
    }

    // Get prediction
    const inputTensor = tf.tensor2d([features]);
    const prediction = this.model!.predict(inputTensor) as tf.Tensor;
    const probabilities = await prediction.data();
    
    inputTensor.dispose();
    prediction.dispose();

    // Find highest probability class
    let maxProb = 0;
    let maxIndex = 0;
    for (let i = 0; i < probabilities.length; i++) {
      if (probabilities[i] > maxProb) {
        maxProb = probabilities[i];
        maxIndex = i;
      }
    }

    const result: MLPrediction = {
      timestamp: Date.now(),
      class: this.classes[maxIndex],
      confidence: maxProb,
      probabilities: Object.fromEntries(
        this.classes.map((c, i) => [c, probabilities[i]])
      ) as Record<MotionClass, number>,
      features,
    };

    this.lastPrediction = result;
    return result;
  }

  public async addTrainingSample(features: number[], label: MotionClass) {
    await addTrainingData(features, label);
  }

  public async train(onProgress?: (progress: number) => void): Promise<number> {
    if (!this.model || this.isTraining) return 0;

    this.isTraining = true;
    
    try {
      const trainingData = await getTrainingData();
      if (trainingData.length < 10) {
        console.warn('Not enough training data');
        return 0;
      }

      // Prepare tensors
      const xs = tf.tensor2d(trainingData.map(d => d.features));
      const ys = tf.tensor2d(trainingData.map(d => {
        const oneHot = new Array(this.classes.length).fill(0);
        const index = this.classes.indexOf(d.label as MotionClass);
        if (index >= 0) oneHot[index] = 1;
        return oneHot;
      }));

      // Train
      const history = await this.model.fit(xs, ys, {
        epochs: 50,
        batchSize: 16,
        validationSplit: 0.2,
        shuffle: true,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            onProgress?.(epoch / 50);
          },
        },
      });

      xs.dispose();
      ys.dispose();

      // Save model
      await this.model.save('indexeddb://motion-classifier');

      const finalAccuracy = history.history.acc?.[history.history.acc.length - 1] as number || 0;
      return finalAccuracy;
    } finally {
      this.isTraining = false;
    }
  }

  public async clearModel() {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    this.isLoaded = false;
    await clearTrainingData();
    this.createModel();
  }

  public getState(): MLModelState {
    return {
      isLoaded: this.isLoaded,
      isTraining: this.isTraining,
      accuracy: 0, // Would need to track this
      lastPrediction: this.lastPrediction,
      trainingProgress: 0,
    };
  }

  public dispose() {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    this.isLoaded = false;
  }
}

// ============================================================================
// SIMPLE RULE-BASED CLASSIFIER (Fallback)
// ============================================================================

export class SimpleMotionClassifier {
  public classify(data: {
    wifiIntensity: number;
    bluetoothNearby: number;
    sonarMovement: number;
    lightShadow: boolean;
    networkActive: number;
  }): { class: MotionClass; confidence: number } {
    const { wifiIntensity, bluetoothNearby, sonarMovement, lightShadow, networkActive } = data;

    // Simple rule-based classification
    if (wifiIntensity < 0.1 && sonarMovement < 0.1 && !lightShadow) {
      return { class: 'idle', confidence: 0.8 };
    }

    if (wifiIntensity > 0.7 || sonarMovement > 0.7) {
      if (bluetoothNearby > 3) {
        return { class: 'multiple_people', confidence: 0.6 };
      }
      return { class: 'walking', confidence: 0.7 };
    }

    if (wifiIntensity > 0.4 && wifiIntensity < 0.7) {
      return { class: 'standing', confidence: 0.5 };
    }

    if (lightShadow && wifiIntensity > 0.2) {
      return { class: 'approaching', confidence: 0.5 };
    }

    return { class: 'unknown', confidence: 0.3 };
  }
}
