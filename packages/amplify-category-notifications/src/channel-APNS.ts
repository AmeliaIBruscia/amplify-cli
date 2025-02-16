import inquirer, { QuestionCollection } from 'inquirer';
import ora from 'ora';
import fs from 'fs-extra';
import { $TSAny, $TSContext, exitOnNextTick } from 'amplify-cli-core';
import { printer } from 'amplify-prompts';
import { run as configureKeyRun } from './apns-key-config';
import { run as configureCertificateRun } from './apns-cert-config';

const channelName = 'APNS';
const spinner = ora('');

/**
 * Configure the Pinpoint resource to enable the Apple Push Notifications Messaging channel
 * @param context amplify cli context
 */
export const configure = async (context: $TSContext): Promise<void> => {
  const isChannelEnabled = context.exeInfo.serviceMeta.output[channelName]?.Enabled;

  if (isChannelEnabled) {
    printer.info(`The ${channelName} channel is currently enabled`);
    const answer = await inquirer.prompt({
      name: 'disableChannel',
      type: 'confirm',
      message: `Do you want to disable the ${channelName} channel`,
      default: false,
    });
    if (answer.disableChannel) {
      await disable(context);
    } else {
      const successMessage = `The ${channelName} channel has been successfully updated.`;
      await enable(context, successMessage);
    }
  } else {
    const answer = await inquirer.prompt({
      name: 'enableChannel',
      type: 'confirm',
      message: `Do you want to enable the ${channelName} channel`,
      default: true,
    });
    if (answer.enableChannel) {
      await enable(context, undefined);
    }
  }
};

/**
 * Enable Walkthrough for the APN (Apple Push Notifications) channel for notifications
 * @param context amplify cli context
 * @param successMessage optional message to be displayed on successfully enabling channel for notifications
 */
export const enable = async (context: $TSContext, successMessage: string | undefined) : Promise<$TSAny> => {
  let channelInput;
  let answers;
  if (context.exeInfo.pinpointInputParams?.[channelName]) {
    channelInput = validateInputParams(context.exeInfo.pinpointInputParams[channelName]);
    answers = {
      DefaultAuthenticationMethod: channelInput.DefaultAuthenticationMethod,
    };
  } else {
    let channelOutput : $TSAny = {};
    if (context.exeInfo.serviceMeta.output[channelName]) {
      channelOutput = context.exeInfo.serviceMeta.output[channelName];
    }
    const question: QuestionCollection<{ [x: string]: unknown; }> = {
      name: 'DefaultAuthenticationMethod',
      type: 'list',
      message: 'Choose authentication method used for APNs',
      choices: ['Certificate', 'Key'],
      default: channelOutput.DefaultAuthenticationMethod || 'Certificate',
    };
    answers = await inquirer.prompt(question);
  }

  try {
    if (answers.DefaultAuthenticationMethod === 'Key') {
      const keyConfig = await configureKeyRun(channelInput);
      Object.assign(answers, keyConfig);
    } else {
      const certificateConfig = await configureCertificateRun(channelInput);
      Object.assign(answers, certificateConfig);
    }
  } catch (err) {
    printer.error(err.message);
    await context.usageData.emitError(err);
    exitOnNextTick(1);
  }

  spinner.start('Updating APNS Channel.');

  const params = {
    ApplicationId: context.exeInfo.serviceMeta.output.Id,
    APNSChannelRequest: {
      ...answers,
      Enabled: true,
    },
  };

  const sandboxParams = {
    ApplicationId: context.exeInfo.serviceMeta.output.Id,
    APNSSandboxChannelRequest: {
      ...answers,
      Enabled: true,
    },
  };

  let data;
  try {
    // eslint-disable-next-line spellcheck/spell-checker
    data = await context.exeInfo.pinpointClient.updateApnsChannel(params).promise();
    // eslint-disable-next-line spellcheck/spell-checker
    await context.exeInfo.pinpointClient.updateApnsSandboxChannel(sandboxParams).promise();
    context.exeInfo.serviceMeta.output[channelName] = data.APNSChannelResponse;
  } catch (e) {
    spinner.fail(`Failed to update the ${channelName} channel.`);
    throw e;
  }

  if (!successMessage) {
    spinner.succeed(`The ${channelName} channel has been successfully enabled.`);
  } else {
    spinner.succeed(successMessage);
  }

  return data;
};

const validateInputParams = (channelInput: $TSAny): $TSAny => {
  if (channelInput.DefaultAuthenticationMethod) {
    const authMethod = channelInput.DefaultAuthenticationMethod;
    if (authMethod === 'Certificate') {
      if (!channelInput.P12FilePath) {
        throw new Error('P12FilePath is missing for the APNS channel');
      } else if (!fs.existsSync(channelInput.P12FilePath)) {
        throw new Error(`P12 file ${channelInput.P12FilePath} can NOT be found for the APNS channel`);
      }
    } else if (authMethod === 'Key') {
      if (!channelInput.BundleId || !channelInput.TeamId || !channelInput.TokenKeyId) {
        throw new Error('Missing BundleId, TeamId or TokenKeyId for the APNS channel');
      } else if (!channelInput.P8FilePath) {
        throw new Error('P8FilePath is missing for the APNS channel');
      } else if (!fs.existsSync(channelInput.P8FilePath)) {
        throw new Error(`P8 file ${channelInput.P8FilePath} can NOT be found for the APNS channel`);
      }
    } else {
      throw new Error(`DefaultAuthenticationMethod ${authMethod} is unrecognized for the APNS channel`);
    }
  } else {
    throw new Error('DefaultAuthenticationMethod is missing for the APNS channel');
  }

  return channelInput;
};

/**
 * Disable walkthrough for APN type notifications channel information from the cloud and update the Pinpoint resource metadata
 * @param context amplify cli notifications
 * @returns APNChannel response
 */
export const disable = async (context: $TSContext) : Promise<$TSAny> => {
  const params = {
    ApplicationId: context.exeInfo.serviceMeta.output.Id,
    APNSChannelRequest: {
      Enabled: false,
    },
  };

  const sandboxParams = {
    ApplicationId: context.exeInfo.serviceMeta.output.Id,
    APNSSandboxChannelRequest: {
      Enabled: false,
    },
  };

  spinner.start('Updating APNS Channel.');

  let data;
  try {
    // eslint-disable-next-line spellcheck/spell-checker
    data = await context.exeInfo.pinpointClient.updateApnsChannel(params).promise();
    // eslint-disable-next-line spellcheck/spell-checker
    await context.exeInfo.pinpointClient.updateApnsSandboxChannel(sandboxParams).promise();
  } catch (e) {
    spinner.fail(`Failed to update the ${channelName} channel.`);
    throw e;
  }

  spinner.succeed(`The ${channelName} channel has been disabled.`);
  context.exeInfo.serviceMeta.output[channelName] = data.APNSChannelResponse;
  return data;
};

/**
 * Pull Walkthrough for APN type notifications channel information from the cloud and update the Pinpoint resource metadata
 * @param context amplify cli context
 * @param pinpointApp Pinpoint resource metadata
 * @returns APNChannel response
 */
export const pull = async (context: $TSContext, pinpointApp: $TSAny): Promise<$TSAny> => {
  const params = {
    ApplicationId: pinpointApp.Id,
  };

  spinner.start(`Retrieving channel information for ${channelName}.`);
  try {
    // eslint-disable-next-line spellcheck/spell-checker
    const data = await context.exeInfo.pinpointClient.getApnsChannel(params).promise();
    spinner.succeed(`Channel information retrieved for ${channelName}`);

    // eslint-disable-next-line no-param-reassign
    pinpointApp[channelName] = data.APNSChannelResponse;
    return data.APNSChannelResponse;
  } catch (e) {
    if (e.code === 'NotFoundException') {
      spinner.succeed(`Channel is not setup for ${channelName} `);
      return e;
    }
    spinner.stop();
    throw e;
  }
};
