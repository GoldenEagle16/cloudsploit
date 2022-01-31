var async = require('async');
var helpers = require('../../../helpers/aws');

module.exports = {
    title: 'SSM Session Duration',
    category: 'SSM',
    domain: 'Identity Access and Management',
    description: 'Ensure that all active sessions in the AWS Session Manager do not exceed the duration set in the settings.',
    more_info: 'The session manager gives users the ability to either open a shell in a EC2 instance or execute commands in a ECS task. This can be useful for when debugging issues in a container or instance.',
    recommended_action: 'Terminate all the sessions which exceed the specified duration mentioned in settings.',
    link: 'https://docs.aws.amazon.com/systems-manager/latest/userguide/session-preferences-max-timeout.html',
    apis: ['SSM:describeSessions'],
    settings: {
        ssm_session_max_duration: {
            name: 'Max Duration for SSM Session.',
            description: 'Maximum duration for SSM session.',
            regex: '^((1440)|(14[0-3][0-9]{1})|(1[0-3][0-9]{2})|([1-9][0-9]{2})|([1-9][0-9]{1})|([1-9]))$',
            default: 5
        }
    },

    run: function(cache, settings, callback) {
        var results = [];
        var source = {};
        var regions = helpers.regions(settings);
        var acctRegion = helpers.defaultRegion(settings);
        var awsOrGov = helpers.defaultPartition(settings);
        var accountId = helpers.addSource(cache, source, ['sts', 'getCallerIdentity', acctRegion, 'data']);

        var sessionMaxDuration = settings.ssm_session_max_duration || this.settings.ssm_session_max_duration.default;
        if (typeof sessionMaxDuration === 'string') {
            sessionMaxDuration.match(this.settings.ssm_session_max_duration.regex);
            sessionMaxDuration = parseInt(sessionMaxDuration);
        }

        async.each(regions.ssm, function(region, rcb){
            var describeSessions = helpers.addSource(cache, source,
                ['ssm', 'describeSessions', region]);

            if (!describeSessions) return rcb();

            if (describeSessions.err || !describeSessions.data) {
                helpers.addResult(results, 3,
                    'Unable to query for active SSM sessions: ' + helpers.addError(describeSessions), region);
                return rcb();
            }

            if (!describeSessions.data.length) {
                helpers.addResult(results, 0,
                    'No Active SSM sessions found: ' + helpers.addError(describeSessions), region);
                return rcb();
            }

            const uniqInstances = describeSessions.data.filter((value, index, self) =>
                index === self.findIndex((t) => (t.Target === value.Target))
            );

            for (let session of uniqInstances) {
                var resource = `arn:${awsOrGov}:ec2:${region}:${accountId}:/instance/${session.Target}`;
                let activeSessionTimeInMins = helpers.minutesBetween(new Date(), session.StartDate);

                if (sessionMaxDuration) {
                    if (sessionMaxDuration > activeSessionTimeInMins) {
                        helpers.addResult(results, 0,
                            `SSM Session duration length is ${activeSessionTimeInMins} minutes which is less than the \
                            max time set in SSM Session Manager ${sessionMaxDuration} minutes`,
                            region, resource);
                    } else {
                        helpers.addResult(results, 2,
                            `SSM Session duration length is ${activeSessionTimeInMins} minutes which is greater than \
                            the max time set in SSM Session Manager ${session.MaxSessionDuration} minutes`, region, resource);
                    }
                }
            }

            rcb();
        }, function(){
            callback(null, results, source);
        });
    }
};
