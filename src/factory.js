import { connect } from 'react-redux'
import hoistStatics from 'hoist-non-react-statics'
import isEmpty from 'lodash.isempty'

export default function factory(React, empty) {

  const defaults = {
    LoadingComponent: () => React.createElement(empty), // dont allow passthrough of props from wrapper
    failureRedirectPath: '/login',
    FailureComponent: undefined,
    redirectQueryParamName: 'redirect',
    wrapperDisplayName: 'AuthWrapper',
    predicate: x => !isEmpty(x),
    authenticatingSelector: () => false,
    allowRedirectBack: true
  }

  const { Component, PropTypes } = React

  return (args) => {
    const { authSelector, authenticatingSelector, LoadingComponent, failureRedirectPath, FailureComponent,
            wrapperDisplayName, predicate, allowRedirectBack, redirectAction, redirectQueryParamName } = {
              ...defaults,
              ...args
            }

    const isAuthorized = (authData) => predicate(authData)

    const createRedirect = (location, redirect, redirectPath) => {
      let query
      if (allowRedirectBack) {
        query = { [redirectQueryParamName]: `${location.pathname}${location.search}` }
      } else {
        query = {}
      }

      redirect({
        pathname: redirectPath,
        query
      })
    }

    const isRedirect = FailureComponent === undefined
    const locationShape = PropTypes.shape({
      pathname: PropTypes.string.isRequired,
      search: PropTypes.string.isRequired
    })

    // Wraps the component that needs the auth enforcement
    function wrapComponent(DecoratedComponent) {
      const displayName = DecoratedComponent.displayName || DecoratedComponent.name || 'Component'

      const mapDispatchToProps = (dispatch) => {
        if (redirectAction !== undefined) {
          return { redirect: (args) => dispatch(redirectAction(args)) }
        } else {
          return {}
        }
      }

      @connect(
        (state, ownProps) => {
          return {
            authData: authSelector(state, ownProps, false),
            failureRedirectPath: typeof failureRedirectPath === 'function' ? failureRedirectPath(state, ownProps) : failureRedirectPath,
            isAuthenticating: authenticatingSelector(state, ownProps)
          }
        },
        mapDispatchToProps,
      )
      class UserAuthWrapper extends Component {

        static displayName = `${wrapperDisplayName}(${displayName})`;

        static propTypes = {
          failureRedirectPath: PropTypes.string.isRequired,
          location: isRedirect ? locationShape.isRequired : locationShape,
          redirect: PropTypes.func,
          authData: PropTypes.object
        };

        static contextTypes = {
          // Only used if no redirectAction specified
          router: React.PropTypes.object
        };

        componentWillMount() {
          if(!this.props.isAuthenticating && !isAuthorized(this.props.authData) && isRedirect) {
            createRedirect(this.props.location, this.getRedirectFunc(this.props), this.props.failureRedirectPath)
          }
        }

        componentWillReceiveProps(nextProps) {
          const willBeAuthorized = isAuthorized(nextProps.authData)
          const willbeAuthenticating = nextProps.isAuthenticating
          const wasAuthorized = isAuthorized(this.props.authData)
          const wasAuthenticating = this.props.isAuthenticating

          // Don't bather to redirect if:
          // 1. currently authenticating or FailureComponent is set
          if (willbeAuthenticating || !isRedirect)
            return

          // Redirect if:
          if ( // 1. Was authorized, but no longer
                (wasAuthorized && !willBeAuthorized) ||
              // 2. Was not authorized and authenticating
                (wasAuthenticating && !willBeAuthorized)
            ) {
            createRedirect(nextProps.location, this.getRedirectFunc(nextProps), nextProps.failureRedirectPath)
          }
        }

        getRedirectFunc = ({ redirect }) => {
          if (redirect) {
            return redirect
          } else {
            if (!this.context.router.replace) {
              /* istanbul ignore next sanity */
              throw new Error(`You must provide a router context (or use React-Router 2.x) if not passing a redirectAction to ${wrapperDisplayName}`)
            } else {
              return this.context.router.replace
            }
          }
        };

        render() {
          // Allow everything but the replace aciton creator to be passed down
          // Includes route props from React-Router and authData
          const { redirect, authData, isAuthenticating, ...otherProps } = this.props // eslint-disable-line no-unused-vars
          if (isAuthorized(authData)) {
            return <DecoratedComponent authData={authData} {...otherProps} />
          } else if(isAuthenticating) {
            return <LoadingComponent {...otherProps} />
          } else {
            // Unauthorized: Display FailureComponent or nothing
            // if FailureComponent is undefined the user will never see
            // this because they will be redirected to failureRedirectPath
            return FailureComponent || React.createElement(empty)
          }
        }
      }

      return hoistStatics(UserAuthWrapper, DecoratedComponent)
    }

    if (isRedirect) {
      wrapComponent.onEnter = (store, nextState, replace) => {
        const authData = authSelector(store.getState(), null, true)
        const redirectPath = typeof failureRedirectPath === 'function' ? failureRedirectPath(store.getState(), null) : failureRedirectPath

        if (!isAuthorized(authData)) {
          createRedirect(nextState.location, replace, redirectPath)
        }
      }
    }

    return wrapComponent
  }
}
